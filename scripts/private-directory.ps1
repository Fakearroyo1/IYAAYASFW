param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
$path=[IO.Path]::GetFullPath($Directory)
$info=[IO.DirectoryInfo]::new($path)
if(-not $info.Exists){throw 'Private directory must already exist.'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[IO.FileSystemAclExtensions]::GetAccessControl($info,[Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true,$false)
foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($rule)}
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
[IO.FileSystemAclExtensions]::SetAccessControl($info,$acl)
