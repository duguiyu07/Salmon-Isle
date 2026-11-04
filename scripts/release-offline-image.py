"""Build a Docker-loadable Linux image from a verified cached Node base and standalone output.
No daemon or registry is required. Native sharp packages come from the same verified archive.
"""
import argparse,copy,datetime,gzip,hashlib,io,json,os,shutil,tarfile
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--base',required=True,help='Previously verified Docker image tar.gz containing Node 24 and Linux sharp')
parser.add_argument('--output',default='dist/deployment/offline')
args=parser.parse_args()
root=Path.cwd();base=Path(args.base).resolve();output=Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True)
standalone=root/'.next/standalone'
version=json.loads((root/'package.json').read_text('utf-8'))['version'];image='ghcr.io/duguiyu07/salmon-isle:'+version
stage=root/'.qa-artifacts'/('image-'+version);stage.mkdir(parents=True,exist_ok=True)

def digest_file(file):
 h=hashlib.sha256()
 with open(file,'rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def json_bytes(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def add_bytes(tar,name,data,uid=0,mode=0o644):
 info=tarfile.TarInfo(name);info.size=len(data);info.mode=mode;info.uid=info.gid=uid;info.uname=info.gname='node' if uid==1000 else 'root';tar.addfile(info,io.BytesIO(data))
def directory(tar,name,uid=1000):
 info=tarfile.TarInfo(name);info.type=tarfile.DIRTYPE;info.mode=0o755;info.uid=info.gid=uid;info.uname=info.gname='node' if uid==1000 else 'root';tar.addfile(info)

checksum=base.with_name(base.name+'.sha256')
if not checksum.exists():raise RuntimeError('Cached image must have an adjacent .sha256 verification file')
base_hash=digest_file(base)
if base_hash!=checksum.read_text('utf-8').split()[0].removeprefix('sha256:'):raise RuntimeError('Cached image checksum mismatch')
if json.loads((standalone/'package.json').read_text('utf-8'))['version']!=version:raise RuntimeError('Build the current version first')
with tarfile.open(base,'r:gz') as archive:
 manifest=json.load(archive.extractfile('manifest.json'))[0];config_raw=archive.extractfile(manifest['Config']).read();config=json.loads(config_raw)
 if config.get('os')!='linux' or config.get('architecture')!='amd64':raise RuntimeError('Expected Linux amd64 base')
 if 'NODE_VERSION=24.22.1' not in config['config']['Env']:raise RuntimeError('Unexpected Node base version')
 if hashlib.sha256(config_raw).hexdigest()!=Path(manifest['Config']).stem:raise RuntimeError('Cached image config digest mismatch')
 # The first five layers are the official Debian/Node runtime, before site files and Git.
 base_layers=[]
 for index,name in enumerate(manifest['Layers'][:5]):
  target=stage/('base-'+str(index)+'.tar')
  with archive.extractfile(name) as source,open(target,'wb') as destination:shutil.copyfileobj(source,destination)
  if 'sha256:'+digest_file(target)!=config['rootfs']['diff_ids'][index]:raise RuntimeError('Base layer digest mismatch')
  base_layers.append(target)
 # Discover the original application and CA layers from Docker history.
 real=[history for history in config['history'] if not history.get('empty_layer')]
 app_index=next(i for i,history in enumerate(real) if 'standalone' in history.get('created_by',''))
 app_tar=stage/'linux-app-cache.tar'
 with archive.extractfile(manifest['Layers'][app_index]) as source,open(app_tar,'wb') as destination:shutil.copyfileobj(source,destination)
 if 'sha256:'+digest_file(app_tar)!=config['rootfs']['diff_ids'][app_index]:raise RuntimeError('Native package layer digest mismatch')
 ca_index=next(i for i,history in enumerate(real) if 'apt-get' in history.get('created_by','') and '/data' in history.get('created_by',''))
 ca_tar=stage/'ca-cache.tar'
 with archive.extractfile(manifest['Layers'][ca_index]) as source,open(ca_tar,'wb') as destination:shutil.copyfileobj(source,destination)
 if 'sha256:'+digest_file(ca_tar)!=config['rootfs']['diff_ids'][ca_index]:raise RuntimeError('CA layer digest mismatch')

layer=stage/'website.tar';native_names=[];file_count=0
with tarfile.open(layer,'w',format=tarfile.PAX_FORMAT) as tar:
 directory(tar,'app');directory(tar,'data')
 def tree(source,prefix):
  global file_count
  for item in sorted(source.rglob('*')):
   relative=item.relative_to(source).as_posix();name=prefix+'/'+relative
   if any(part in {'win32-x64','sharp-win32-x64','sharp-libvips-win32-x64'} or part.startswith('sharp-darwin') or part.startswith('sharp-linuxmusl') for part in item.relative_to(source).parts):continue
   if source==standalone and (relative=='public' or relative.startswith('public/') or relative=='.next/static' or relative.startswith('.next/static/')):continue
   if relative.startswith('.next/cache/') or item.suffix.lower() in {'.node','.dll','.exe'}:continue
   if item.is_symlink():raise RuntimeError('Unexpected symlink in standalone output: '+relative)
   if item.is_dir():directory(tar,name);continue
   if item.is_file():
    info=tar.gettarinfo(str(item),arcname=name);info.uid=info.gid=1000;info.uname=info.gname='node';info.mode=0o644
    with open(item,'rb') as stream:tar.addfile(info,stream)
    file_count+=1
 tree(standalone,'app');tree(root/'.next/static','app/.next/static');tree(root/'public','app/public')
 with tarfile.open(app_tar) as old:
  sharp=json.load(old.extractfile('app/node_modules/sharp/package.json'))
  current=json.loads((standalone/'node_modules/sharp/package.json').read_text('utf-8'))
  if sharp['version']!=current['version']:raise RuntimeError('Linux native sharp version differs from this build')
  prefixes=('app/node_modules/@img/sharp-linux-x64','app/node_modules/@img/sharp-libvips-linux-x64')
  for member in old:
   if any(member.name==prefix or member.name.startswith(prefix+'/') for prefix in prefixes):
    info=copy.copy(member);info.uid=info.gid=1000;info.uname=info.gname='node'
    if member.isfile():
     data=old.extractfile(member).read()
     if member.name.endswith('.node') and not data.startswith(b'\x7fELF'):raise RuntimeError('Non-Linux native module')
     tar.addfile(info,io.BytesIO(data));native_names.append(member.name)
    else:tar.addfile(info)
 with tarfile.open(ca_tar) as certs:
  for member in certs:
   if member.name.startswith(('etc/ssl/certs/','usr/share/ca-certificates/')) or member.name=='etc/ca-certificates.conf':tar.addfile(member,certs.extractfile(member) if member.isfile() else None)
if not any(name.endswith('.node') for name in native_names):raise RuntimeError('Missing Linux sharp module')

now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
base_history=[];count=0
for history in config['history']:
 if not history.get('empty_layer'):
  count+=1
  if count>5:break
 base_history.append(history)
new_config={'created':now,'architecture':'amd64','os':'linux','config':copy.deepcopy(config['config']),'rootfs':{'type':'layers','diff_ids':['sha256:'+digest_file(file) for file in base_layers+[layer]]},'history':base_history+[{'created':now,'created_by':'Salmon Isle '+version+' standalone website, Linux native modules and CA certificates'}]}
new_config['config'].pop('ArgsEscaped',None)
new_config['config']['Labels']['org.opencontainers.image.version']=version
config_bytes=json_bytes(new_config);config_hash=hashlib.sha256(config_bytes).hexdigest();layer_names=[digest_file(file)+'/layer.tar' for file in base_layers+[layer]]
new_manifest=[{'Config':config_hash+'.json','RepoTags':[image],'Layers':layer_names}]
archive_file=output/('Salmon-Isle-Image-'+version+'-linux-amd64.tar.gz')
with open(archive_file,'wb') as destination,gzip.GzipFile(fileobj=destination,mode='wb',compresslevel=6,mtime=0) as compressed,tarfile.open(fileobj=compressed,mode='w|') as tar:
 for file,name in zip(base_layers+[layer],layer_names):
  info=tar.gettarinfo(str(file),arcname=name);info.mode=0o644;info.uid=info.gid=0
  with open(file,'rb') as stream:tar.addfile(info,stream)
 add_bytes(tar,config_hash+'.json',config_bytes);add_bytes(tar,'manifest.json',json_bytes(new_manifest))
# Verify every layer again by streaming the generated compressed archive.
with tarfile.open(archive_file,'r|gz') as tar:
 verified=0
 for member in tar:
  if member.name.endswith('/layer.tar'):
   h=hashlib.sha256()
   with tar.extractfile(member) as stream:
    for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
   if member.name.split('/')[0]!=h.hexdigest():raise RuntimeError('Output layer integrity failure')
   verified+=1
 if verified!=6:raise RuntimeError('Incomplete output layers')
archive_hash=digest_file(archive_file);archive_file.with_name(archive_file.name+'.sha256').write_text(archive_hash+'  '+archive_file.name+'\n','utf-8')
report={'version':version,'image':image,'platform':'linux/amd64','imageId':'sha256:'+config_hash,'archive':archive_file.name,'archiveBytes':archive_file.stat().st_size,'archiveSha256':archive_hash,'cachedBaseArchiveSha256':base_hash,'allLayersVerified':True,'layers':6,'applicationFiles':file_count,'linuxNativePackages':native_names,'privateDataIncluded':False,'dockerLoadTested':False,'runtimeVerification':'Container execution not performed by this exporter; see the acceptance report'}
(output/('verification-'+version+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({key:report[key] for key in ['image','platform','imageId','archive','archiveBytes','allLayersVerified']},ensure_ascii=False,indent=2))
