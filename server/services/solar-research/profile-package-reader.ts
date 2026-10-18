import type {HelixProfileStorageSnapshot} from '../../../shared/helix-profile-storage';
import {readProfileStorageSnapshot} from '../helix-account/profile-storage-store';
import {solarPackageCatalogSchema} from '../../../shared/solar-package-catalog';
import {SOLAR_PACKAGE_MANIFEST_BYTES,SOLAR_PACKAGE_MAX_CHUNKS,SOLAR_PACKAGE_STORAGE_PREFIX,
  verifySolarPackageStorage,type SolarPackageOwner} from './package-storage-codec';

/** Internal owner-scoped source reader, not an authorized MCP facade. */
export class SolarResearchProfilePackageReader {
  constructor(private readonly snapshots:(profileId:string)=>Promise<HelixProfileStorageSnapshot>=readProfileStorageSnapshot) {}

  async readCatalog(owner:SolarPackageOwner,offset:number,limit:number) {
    const boundOwner={...owner};
    return {owner:boundOwner,catalog:await this.list(boundOwner,offset,limit)};
  }

  /** Explicit bounded catalog. Fully verifies only the selected owner page. */
  async list(owner:SolarPackageOwner,offset=0,limit=10) {
    const boundOwner={...owner};
    if(!boundOwner.tenantId||!boundOwner.accountProfileId||boundOwner.tenantId.length>256||boundOwner.accountProfileId.length>256)
      throw new Error('SOLAR_PACKAGE_OWNER_INVALID');
    if(!Number.isInteger(offset)||offset<0||offset>99||!Number.isInteger(limit)||limit<1||limit>20)
      throw new Error('SOLAR_PACKAGE_PAGE_INVALID');
    const snapshot=await this.snapshots(boundOwner.accountProfileId);
    if(snapshot.profile_id!==boundOwner.accountProfileId)throw new Error('SOLAR_PACKAGE_OWNER_MISMATCH');
    const manifests=snapshot.entries.filter(entry=>entry.storage_key.startsWith(SOLAR_PACKAGE_STORAGE_PREFIX)&&entry.storage_key.endsWith(':manifest'));
    if(manifests.length>100)throw new Error('SOLAR_PACKAGE_CATALOG_LIMIT');
    const ids:string[]=[];
    for(const entry of manifests) {
      if(typeof entry.value!=='string'||Buffer.byteLength(entry.value)>SOLAR_PACKAGE_MANIFEST_BYTES)
        throw new Error('SOLAR_PACKAGE_STORAGE_SIZE_LIMIT');
      const declared=JSON.parse(entry.value);
      if(declared?.owner?.tenantId!==boundOwner.tenantId||declared?.owner?.accountProfileId!==boundOwner.accountProfileId)continue;
      const match=/^solar-research-package:(solar-package:[a-f0-9]{64}):manifest$/.exec(entry.storage_key);
      if(!match||declared.packageId!==match[1]||ids.includes(match[1]))throw new Error('SOLAR_PACKAGE_CATALOG_INVALID');
      ids.push(match[1]);
    }
    ids.sort();
    const reader=new SolarResearchProfilePackageReader(async()=>snapshot);
    const packages=[];
    for(const id of ids.slice(offset,offset+limit)) {
      const stored=await reader.read(boundOwner,id);
      if(!stored)throw new Error('SOLAR_PACKAGE_NOT_FOUND');
      const verified=stored.verified;
      packages.push({packageId:stored.packageId,indexId:stored.indexId,totalBytes:Buffer.byteLength(stored.packageJson),
        comparisonRecordId:verified.manifest.comparison.recordId,comparisonRows:verified.record.rows.length,
        archiveId:verified.archiveReplay?.archive_identity?.snapshotId??null,
        literatureId:verified.literatureReplay?.associationId??null,benchmarkId:verified.benchmarkReplay?.planId??null,
        artifactIntegrityVerified:true,sourceIdentityAuthenticated:false,scientificAdmission:false,scienceRunAllowed:false});
    }
    return solarPackageCatalogSchema.parse({schemaVersion:'solar-package-catalog/1',totalPackages:ids.length,offset,packages,
      nextOffset:offset+packages.length<ids.length?offset+packages.length:null,
      order:'package_id_lexicographic',scientificAdmission:false,scienceRunAllowed:false});
  }

  async read(owner:SolarPackageOwner,packageId:string) {
    const boundOwner={...owner};
    if(!boundOwner.tenantId || !boundOwner.accountProfileId || boundOwner.tenantId.length>256 || boundOwner.accountProfileId.length>256)
      throw new Error('SOLAR_PACKAGE_OWNER_INVALID');
    if(!/^solar-package:[a-f0-9]{64}$/.test(packageId))throw new Error('SOLAR_PACKAGE_ID_INVALID');
    const snapshot=await this.snapshots(boundOwner.accountProfileId);
    if(snapshot.profile_id!==boundOwner.accountProfileId)throw new Error('SOLAR_PACKAGE_OWNER_MISMATCH');
    const base=`${SOLAR_PACKAGE_STORAGE_PREFIX}${packageId}:`;
    const manifests=snapshot.entries.filter(e=>e.storage_key===base+'manifest');
    if(!manifests.length)return null;
    if(manifests.length!==1)throw new Error('SOLAR_PACKAGE_DUPLICATE_ENTRY');
    const value=manifests[0].value;
    if(typeof value!=='string' || Buffer.byteLength(value)>SOLAR_PACKAGE_MANIFEST_BYTES)
      throw new Error('SOLAR_PACKAGE_STORAGE_SIZE_LIMIT');
    const declared=JSON.parse(value);
    // Reject ownership before inspecting/decoding any package chunks.
    if(declared?.owner?.tenantId!==boundOwner.tenantId || declared?.owner?.accountProfileId!==boundOwner.accountProfileId)
      throw new Error('SOLAR_PACKAGE_OWNER_MISMATCH');
    const entries=snapshot.entries.filter(e=>e.storage_key.startsWith(base) && e.storage_key!==base+'manifest');
    if(entries.length>SOLAR_PACKAGE_MAX_CHUNKS)throw new Error('SOLAR_PACKAGE_CHUNKS_INVALID');
    const chunks=entries.map(e=>{
      const suffix=e.storage_key.slice(base.length);
      if(!/^chunk:(?:[0-9]|1[0-7])$/.test(suffix))throw new Error('SOLAR_PACKAGE_CHUNKS_INVALID');
      return {ordinal:Number(suffix.slice(6)),value:e.value};
    }).sort((a,b)=>a.ordinal-b.ordinal);
    const reopened=await verifySolarPackageStorage(boundOwner,value,chunks);
    if(reopened.packageId!==packageId)throw new Error('SOLAR_PACKAGE_ID_MISMATCH');
    return {owner:boundOwner,...reopened};
  }
}
