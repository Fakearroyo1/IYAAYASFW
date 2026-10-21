param([Parameter(Mandatory=$true)][string]$PrivateDirectory,[switch]$VerifyFromVault)
# Interactive local entry. No key is accepted through command arguments or logs.
# The local working copy is DPAPI-protected for this Windows user. Recovery must
# also retain the portable 32-byte key in Jake's independent password manager.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
$directory = [IO.Path]::GetFullPath($PrivateDirectory)
[IO.Directory]::CreateDirectory($directory) | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$directoryInfo = [IO.DirectoryInfo]::new($directory)
$acl = [IO.FileSystemAclExtensions]::GetAccessControl($directoryInfo,[Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $false)
foreach($oldRule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleSpecific($oldRule)}
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
[IO.FileSystemAclExtensions]::SetAccessControl($directoryInfo,$acl)
$keyPath = Join-Path $directory 'backup-key.dpapi'
$receiptPath = Join-Path $directory 'custody.json'
$form = New-Object Windows.Forms.Form
$form.Text = 'IYAAYASFW backup key - private local entry'
$form.Size = New-Object Drawing.Size(670,390)
$form.StartPosition = 'CenterScreen'
$form.ShowInTaskbar = $true
$form.TopMost = $true
$form.Add_Shown({$form.Activate();$form.BringToFront();[IO.File]::WriteAllText((Join-Path $directory 'window-ready.txt'),'Private key-entry form shown.');$form.TopMost=$false})
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object Windows.Forms.Label
$label.Location = New-Object Drawing.Point(20,20)
$label.Size = New-Object Drawing.Size(610,100)
$label.Text = "Keep this key in your password manager, separate from encrypted backups.`r`nPaste its 64 hexadecimal characters below, or generate and copy a new key.`r`nNothing entered here goes into chat, Git, or a command log.`r`nDo not capture this window in a support screenshot."
if($VerifyFromVault){$label.Text="Recovery check: retrieve the saved backup key from your password manager.`r`nPaste it below to prove the independent copy is available.`r`nDo not use chat to transfer it. No key will be printed or logged."}
$form.Controls.Add($label)
$box = New-Object Windows.Forms.TextBox
$box.Location = New-Object Drawing.Point(20,125)
$box.Size = New-Object Drawing.Size(610,30)
$box.UseSystemPasswordChar = $true
$box.MaxLength = 64
$form.Controls.Add($box)
$generate = New-Object Windows.Forms.Button
$generate.Text = 'Generate new key'
$generate.Location = New-Object Drawing.Point(20,170)
$generate.Size = New-Object Drawing.Size(150,35)
$generate.Enabled = -not $VerifyFromVault
$generate.Add_Click({$bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose();$box.Text=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant();[Array]::Clear($bytes,0,$bytes.Length)})
$form.Controls.Add($generate)
$copy = New-Object Windows.Forms.Button
$copy.Text = 'Copy to password manager'
$copy.Location = New-Object Drawing.Point(185,170)
$copy.Size = New-Object Drawing.Size(220,35)
$copy.Enabled = -not $VerifyFromVault
$copy.Add_Click({if($box.Text -match '^[a-fA-F0-9]{64}$'){[Windows.Forms.Clipboard]::SetText($box.Text)}})
$form.Controls.Add($copy)
$confirmed = New-Object Windows.Forms.CheckBox
$confirmed.Location = New-Object Drawing.Point(20,225)
$confirmed.Size = New-Object Drawing.Size(600,40)
$confirmed.Text = 'I saved this key in my password manager and can recover it without the snackbar app.'
if($VerifyFromVault){$confirmed.Text='I retrieved this key from my independent password-manager copy.'}
$form.Controls.Add($confirmed)
$save = New-Object Windows.Forms.Button
$save.Text = 'Save protected key & continue'
$save.Location = New-Object Drawing.Point(20,280)
$save.Size = New-Object Drawing.Size(260,40)
$save.Add_Click({
 try {
  if(-not $confirmed.Checked -or $box.Text -notmatch '^[a-fA-F0-9]{64}$'){[Windows.Forms.MessageBox]::Show('Enter a valid key and confirm password-manager custody.')|Out-Null;return}
  $bytes = New-Object byte[] 32
  for($i=0;$i -lt 32;$i++){$bytes[$i]=[Convert]::ToByte($box.Text.Substring($i*2,2),16)}
  $hash=[Security.Cryptography.SHA256]::Create();$fingerprint=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant();$hash.Dispose()
  if($VerifyFromVault){$previous=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json;if($previous.fingerprint -ne $fingerprint){[Array]::Clear($bytes,0,$bytes.Length);[Windows.Forms.MessageBox]::Show('This is not the key used for this backup. Retrieve the correct saved key.')|Out-Null;return}}
  $protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes($keyPath,$protected)
  @{fingerprint=$fingerprint;custodian='Jake Arroyo';vaultConfirmedAt=[DateTime]::UtcNow.ToString('o');retrievedFromVault=[bool]$VerifyFromVault} | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  [Array]::Clear($bytes,0,$bytes.Length)
  if([Windows.Forms.Clipboard]::ContainsText() -and [Windows.Forms.Clipboard]::GetText() -eq $box.Text){[Windows.Forms.Clipboard]::Clear()}
  $box.Text='';$form.DialogResult=[Windows.Forms.DialogResult]::OK;$form.Close()
 } catch {[Windows.Forms.MessageBox]::Show('The protected key could not be saved. No secret was logged. Ask Codex to check the local folder permissions.')|Out-Null}
})
$form.Controls.Add($save)
$form.AcceptButton=$save
$result=$form.ShowDialog()
$form.Dispose()
if($result -ne [Windows.Forms.DialogResult]::OK){exit 2}
Write-Output 'Protected local key saved; owner confirmed independent password-manager custody.'
