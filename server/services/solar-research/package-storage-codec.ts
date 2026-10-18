import {createHash} from 'node:crypto';
import {z} from 'zod';
import {SOLAR_EVIDENCE_PACKAGE_MAX_BYTES,verifySolarResearchEvidencePackage} from '../../../shared/solar-research-evidence-package';

export const SOLAR_PACKAGE_CHUNK_BYTES=524_288;
export const SOLAR_PACKAGE_MAX_CHUNKS=18;
export const SOLAR_PACKAGE_MANIFEST_BYTES=16_384;
export const SOLAR_PACKAGE_ENTRY_BYTES=2_097_152;
export const SOLAR_PACKAGE_STORAGE_PREFIX='solar-research-package:';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const Owner=z.object({tenantId:z.string().min(1).max(256),accountProfileId:z.string().min(1).max(256)}).strict();
const Manifest=z.object({schemaVersion:z.literal('solar-package-storage/1'),owner:Owner,
  packageId:z.string().regex(/^solar-package:[a-f0-9]{64}$/),
  indexId:z.string().regex(/^solar-evidence-index:[a-f0-9]{64}$/),
  totalBytes:z.number().int().positive().max(SOLAR_EVIDENCE_PACKAGE_MAX_BYTES),sha256:Hash,
  chunks:z.array(z.object({ordinal:z.number().int().nonnegative().max(17),bytes:z.number().int().positive().max(SOLAR_PACKAGE_CHUNK_BYTES),sha256:Hash}).strict()).min(1).max(SOLAR_PACKAGE_MAX_CHUNKS),
  scientificAdmission:z.literal(false),sourceIdentityAuthenticated:z.literal(false)}).strict();
export type SolarPackageOwner=z.infer<typeof Owner>;
export interface SolarPackageChunk {ordinal:number;value:string}

/** Pure server-side codec. No persistence, scope grant or evidence publication. */
export async function prepareSolarPackageStorage(owner:SolarPackageOwner,packageJson:string) {
  const boundOwner=Owner.parse(owner);
  const verified=await verifySolarResearchEvidencePackage(packageJson);
  const bytes=Buffer.from(packageJson,'utf8');
  const sha256=digest(bytes),packageId=`solar-package:${sha256}`;
  const chunks:SolarPackageChunk[]=[];
  const descriptors=[];
  for(let start=0;start<bytes.length;start+=SOLAR_PACKAGE_CHUNK_BYTES) {
    const chunk=bytes.subarray(start,start+SOLAR_PACKAGE_CHUNK_BYTES);
    const ordinal=chunks.length;
    chunks.push({ordinal,value:chunk.toString('base64')});
    descriptors.push({ordinal,bytes:chunk.length,sha256:digest(chunk)});
  }
  const manifest=Manifest.parse({schemaVersion:'solar-package-storage/1',owner:boundOwner,packageId,
    indexId:verified.indexId,totalBytes:bytes.length,sha256,chunks:descriptors,
    scientificAdmission:false,sourceIdentityAuthenticated:false});
  const manifestJson=JSON.stringify(manifest);
  if(Buffer.byteLength(manifestJson)>SOLAR_PACKAGE_MANIFEST_BYTES || chunks.some(chunk=>Buffer.byteLength(chunk.value)>SOLAR_PACKAGE_ENTRY_BYTES))
    throw new Error('SOLAR_PACKAGE_STORAGE_SIZE_LIMIT');
  return {packageId,indexId:verified.indexId,manifestJson,chunks};
}

export async function verifySolarPackageStorage(owner:SolarPackageOwner,manifestJson:string,chunks:SolarPackageChunk[]) {
  const expected=Owner.parse(owner);
  if(Buffer.byteLength(manifestJson)>SOLAR_PACKAGE_MANIFEST_BYTES)throw new Error('SOLAR_PACKAGE_STORAGE_SIZE_LIMIT');
  const manifest=Manifest.parse(JSON.parse(manifestJson));
  if(manifest.owner.tenantId!==expected.tenantId || manifest.owner.accountProfileId!==expected.accountProfileId)
    throw new Error('SOLAR_PACKAGE_OWNER_MISMATCH');
  if(chunks.length!==manifest.chunks.length)throw new Error('SOLAR_PACKAGE_CHUNKS_INVALID');
  const decoded:Buffer[]=[];
  for(let i=0;i<chunks.length;i++) {
    const chunk=chunks[i],descriptor=manifest.chunks[i];
    if(chunk.ordinal!==i || descriptor.ordinal!==i || typeof chunk.value!=='string' ||
      chunk.value.length!==4*Math.ceil(descriptor.bytes/3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.value))
      throw new Error('SOLAR_PACKAGE_CHUNKS_INVALID');
    const bytes=Buffer.from(chunk.value,'base64');
    if(bytes.length!==descriptor.bytes || bytes.toString('base64')!==chunk.value || digest(bytes)!==descriptor.sha256)
      throw new Error('SOLAR_PACKAGE_CHUNK_INTEGRITY_FAILED');
    decoded.push(bytes);
  }
  const bytes=Buffer.concat(decoded);
  if(bytes.length!==manifest.totalBytes || digest(bytes)!==manifest.sha256 || manifest.packageId!==`solar-package:${manifest.sha256}`)
    throw new Error('SOLAR_PACKAGE_INTEGRITY_FAILED');
  const packageJson=bytes.toString('utf8');
  if(!Buffer.from(packageJson,'utf8').equals(bytes))throw new Error('SOLAR_PACKAGE_UTF8_INVALID');
  const verified=await verifySolarResearchEvidencePackage(packageJson);
  if(verified.indexId!==manifest.indexId)throw new Error('SOLAR_PACKAGE_INDEX_MISMATCH');
  return {packageId:manifest.packageId,indexId:manifest.indexId,packageJson,verified};
}
