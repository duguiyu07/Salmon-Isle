$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $project
try {
  & docker compose exec -T blog node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
  if($LASTEXITCODE -ne 0){throw 'Current website is not healthy'}
  Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup-data.cjs') -Raw | & docker compose exec -T blog node - /data --apply
  if($LASTEXITCODE -ne 0){throw 'Data history cleanup failed'}
  $backupRoot=[IO.Path]::GetFullPath((Join-Path $project 'backups'))
  if(Test-Path -LiteralPath $backupRoot){
    if((Get-Item -LiteralPath $backupRoot).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing linked backup directory'}
    foreach($entry in Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'program-*'){
      $target=[IO.Path]::GetFullPath($entry.FullName)
      if([IO.Path]::GetDirectoryName($target) -ne $backupRoot -or $entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Unsafe cleanup target'}
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
  $current=(& docker compose images -q blog | Select-Object -First 1)
  if($LASTEXITCODE -ne 0 -or -not $current){throw 'Cannot identify the running website image'}
  $currentId=(& docker image inspect --format '{{.Id}}' $current)
  if($LASTEXITCODE -ne 0){throw 'Cannot inspect current image'}
  $tags=@(& docker image ls --format '{{.Repository}}:{{.Tag}}' | Where-Object {$_ -match '^(ghcr.io/duguiyu07/salmon-isle:|salmon-isle-rollback:)'})
  foreach($tag in $tags){
    $imageId=(& docker image inspect --format '{{.Id}}' $tag)
    if($LASTEXITCODE -ne 0){throw 'Cannot inspect historical image'}
    if($imageId -eq $currentId){continue}
    $references=@(& docker ps -aq --filter "ancestor=$imageId")
    if($LASTEXITCODE -ne 0){throw 'Cannot inspect image references'}
    if($references.Count){continue}
    & docker image rm $tag
    if($LASTEXITCODE -ne 0){throw 'Historical image cleanup failed'}
  }
  Write-Output 'Website history cleanup completed. Current library and running images retained.'
} finally {Pop-Location}
