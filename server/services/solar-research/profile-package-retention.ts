import {readProfileStorageSnapshot,writeProfileStorageSnapshot} from '../helix-account/profile-storage-store';
import {prepareSolarPackageStorage,SOLAR_PACKAGE_ENTRY_BYTES,SOLAR_PACKAGE_STORAGE_PREFIX,type SolarPackageOwner} from './package-storage-codec';

/** Internal only: caller authenticates owner and policy quota. No public/MCP write. */
export async function retainSolarProfilePackage(owner:SolarPackageOwner,packageJson:string,quotaBytes:number) {
  const boundOwner={...owner};
  if(!Number.isSafeInteger(quotaBytes)||quotaBytes<0)throw new Error('SOLAR_PACKAGE_QUOTA_INVALID');
  const prepared=await prepareSolarPackageStorage(boundOwner,packageJson);
  const current=await readProfileStorageSnapshot(boundOwner.accountProfileId,{quota_bytes:quotaBytes});
  if(current.profile_id!==boundOwner.accountProfileId)throw new Error('SOLAR_PACKAGE_OWNER_MISMATCH');
  if(current.entries.some(e=>e.storage_backend!=='localStorage' || !current.artifacts.some(a=>
    a.storage_key===e.storage_key && a.artifact_id.trim() && a.storage_backend==='localStorage' &&
    (a.sync_status==='profile_candidate'||a.sync_status==='profile_synced'))))
    throw new Error('SOLAR_PACKAGE_EXISTING_STORAGE_INVALID');
  const base=`${SOLAR_PACKAGE_STORAGE_PREFIX}${prepared.packageId}:`;
  if(current.entries.some(e=>e.storage_key.startsWith(base)))throw new Error('SOLAR_PACKAGE_ALREADY_RETAINED');
  if(current.entries.filter(e=>e.storage_key.startsWith(SOLAR_PACKAGE_STORAGE_PREFIX)&&e.storage_key.endsWith(':manifest')).length>=100)
    throw new Error('SOLAR_PACKAGE_COUNT_LIMIT');
  const updated_at=new Date().toISOString();
  const entries=[{storage_key:base+'manifest',value:prepared.manifestJson},
    ...prepared.chunks.map(c=>({storage_key:base+`chunk:${c.ordinal}`,value:c.value}))]
    .map(e=>({...e,storage_backend:'localStorage' as const,size_bytes:Buffer.byteLength(e.value),updated_at,artifact_ids:[prepared.packageId]}));
  const merged=[...current.entries,...entries];
  if(merged.some(e=>Buffer.byteLength(e.value)>SOLAR_PACKAGE_ENTRY_BYTES))throw new Error('SOLAR_PACKAGE_STORAGE_SIZE_LIMIT');
  if(merged.reduce((sum,e)=>sum+Buffer.byteLength(e.value),0)>quotaBytes)throw new Error('SOLAR_PACKAGE_QUOTA_EXCEEDED');
  const receipt=await writeProfileStorageSnapshot({profile_id:boundOwner.accountProfileId,quota_bytes:quotaBytes,
    expected_storage_revision:current.storage_revision??null,snapshot:{entries:merged,
      artifacts:[...current.artifacts,...entries.map(e=>({schema:'helix.workspace_memory_registry.v1' as const,
        artifact_id:prepared.packageId,artifact_type:'linked_source' as const,owner_scope:'profile' as const,
        storage_backend:'localStorage' as const,sync_status:'profile_candidate' as const,profile_id:boundOwner.accountProfileId,
        chat_session_id:null,title:'Retained solar research evidence package',storage_key:e.storage_key,updated_at}))]}});
  return {packageId:prepared.packageId,indexId:prepared.indexId,saved:receipt.ok,receipt,
    scientificAdmission:false as const,scienceRunAllowed:false as const};
}
