param([string]$Image='')
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $project
try {
  $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $backup=[IO.Path]::GetFullPath((Join-Path $project "backups/program-$stamp"))
  if(-not $backup.StartsWith($project+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe backup directory'}
  $oldImage=(& docker compose images -q blog | Select-Object -First 1)
  if($LASTEXITCODE -ne 0 -or -not $oldImage){throw '请先启动现有网站'}
  $rollbackImage="salmon-isle-rollback:$stamp"
  & docker image tag $oldImage $rollbackImage
  if($LASTEXITCODE -ne 0){throw '无法保存上一镜像'}
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  $configText=(& docker compose config --format json | Out-String)
  if($LASTEXITCODE -ne 0){throw '无法读取 Compose 配置'}
  $config=$configText | ConvertFrom-Json
  $configText | Set-Content -LiteralPath (Join-Path $backup 'compose.json') -Encoding utf8
  if($Image){
    if($Image -notmatch '^ghcr\.io/[a-z0-9._/-]+:[a-zA-Z0-9._-]+$'){throw '镜像地址必须是 ghcr.io 上带版本的程序镜像'}
    & docker pull $Image
  } elseif($config.services.blog.image -eq 'salmon-isle:local'){
    & git rev-parse --is-inside-work-tree *> $null
    if($LASTEXITCODE -ne 0){throw '源码目录未连接 Git；请从后台复制带 -Image 参数的镜像更新命令'}
    & git diff --quiet
    if($LASTEXITCODE -ne 0){throw '源码有未保存改动，请先处理后更新'}
    & git diff --cached --quiet
    if($LASTEXITCODE -ne 0){throw '源码有已暂存改动，请先处理后更新'}
    & git pull --ff-only
    if($LASTEXITCODE -ne 0){throw '源码拉取失败，原网站仍在运行'}
    & docker compose build --pull blog
  }else{& docker compose pull blog}
  if($LASTEXITCODE -ne 0){throw '新镜像准备失败，原网站仍在运行'}
  $rollbackFile=Join-Path $backup 'rollback.yml'
  "services:`n  blog:`n    image: $rollbackImage`n    pull_policy: never" | Set-Content -LiteralPath $rollbackFile -Encoding utf8
  & docker compose stop blog
  if($LASTEXITCODE -ne 0){throw '无法停止网站进行备份'}
  try {
    Copy-Item -LiteralPath (Join-Path $project 'data') -Destination (Join-Path $backup 'data') -Recurse
    if($Image){
      $envFile=Join-Path $project '.env'
      $lines=if(Test-Path -LiteralPath $envFile){Copy-Item -LiteralPath $envFile -Destination (Join-Path $backup 'previous.env');Get-Content -LiteralPath $envFile}else{@()}
      $found=$false
      $next=@($lines | ForEach-Object {if($_ -match '^SALMON_WEB_IMAGE='){$found=$true;"SALMON_WEB_IMAGE=$Image"}else{$_}})
      if(-not $found){$next+="SALMON_WEB_IMAGE=$Image"}
      [IO.File]::WriteAllLines($envFile,$next,[Text.UTF8Encoding]::new($false))
      $env:SALMON_WEB_IMAGE=$Image
    }
    & docker compose up -d --no-deps --wait --wait-timeout 120 blog
    if($LASTEXITCODE -ne 0){throw '新版本启动检查未通过'}
  } catch {
    & docker compose stop blog
    $dataPath=[IO.Path]::GetFullPath((Join-Path $project 'data'))
    $failedData=[IO.Path]::GetFullPath((Join-Path $backup 'failed-data'))
    if($dataPath -ne (Join-Path $project 'data') -or -not $failedData.StartsWith($backup+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe rollback paths'}
    if(Test-Path -LiteralPath (Join-Path $backup 'data')){
      if(Test-Path -LiteralPath $dataPath){Move-Item -LiteralPath $dataPath -Destination $failedData}
      Copy-Item -LiteralPath (Join-Path $backup 'data') -Destination $dataPath -Recurse
      '{"restored":true}' | Set-Content -LiteralPath (Join-Path $dataPath 'sync-restored.json') -Encoding utf8
    }
    if($Image){
      $previousEnv=Join-Path $backup 'previous.env'
      if(Test-Path -LiteralPath $previousEnv){Copy-Item -LiteralPath $previousEnv -Destination (Join-Path $project '.env') -Force}
      $env:SALMON_WEB_IMAGE=$config.services.blog.image
    }
    & docker compose -f (Join-Path $project 'compose.yml') -f $rollbackFile up -d --no-deps --wait --wait-timeout 120 blog
    throw "更新失败，已尝试恢复上一镜像。备份：$backup。$($_.Exception.Message)"
  }
  Write-Output "网站已更新，内容与连接数据保留。备份：$backup"
} finally {Pop-Location}
