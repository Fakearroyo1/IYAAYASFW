param([Parameter(Mandatory=$true)][ValidateSet('database','assets','verify')][string]$Mode,[Parameter(Mandatory=$true)][string]$Output,[string]$Inventory,[string]$Assets,[string]$Baseline,[switch]$RehearseMigration,[switch]$RehearseStaleIdentity)
# Secret passes only through the child environment; no command-line/key output.
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$keyPath=Join-Path $repo '.sites-runtime\private-backup\backup-key.dpapi'
$bytes=$null
try {
 $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyPath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 if($bytes.Length -ne 32){throw 'Unexpected protected-key size.'}
 $env:BACKUP_ENCRYPTION_KEY=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
 $env:IYAAYASFW_POWERSHELL=Join-Path $PSHOME 'pwsh.exe'
 $env:WRANGLER_LOG_PATH=Join-Path $repo '.sites-runtime\private-backup\wrangler-logs'
 $scriptName=@{database='backup-database.mjs';assets='backup-assets.mjs';verify='verify-backup.mjs'}[$Mode]
 $arguments=@((Join-Path $PSScriptRoot $scriptName))
 if($Mode -eq 'assets'){$arguments+=$Inventory}
 $arguments+=$Output
 if($Mode -eq 'verify' -and $Assets){$arguments+=@('--assets',$Assets)}
 if($Mode -eq 'verify' -and $Inventory){$arguments+=@('--inventory',$Inventory)}
 if($Mode -eq 'verify' -and $Baseline){$arguments+=@('--baseline',$Baseline)}
 if($RehearseMigration){$arguments+='--rehearse-migration'}
 if($RehearseStaleIdentity){$arguments+='--rehearse-stale-identity'}
 & node @arguments
 if($LASTEXITCODE -ne 0){throw 'Backup or verification failed; no release gate was passed.'}
} finally {
 Remove-Item Env:BACKUP_ENCRYPTION_KEY -ErrorAction SilentlyContinue
 if($null -ne $bytes){[Array]::Clear($bytes,0,$bytes.Length)}
}
