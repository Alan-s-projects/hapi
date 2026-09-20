param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$ServerName,
    [Parameter(Mandatory=$true)][string]$SecretDirectory,
    [switch]$Resume
)
$ErrorActionPreference = 'Stop'
$taskOpenSSL = 'C:\Program Files\Git\usr\bin\openssl.exe'
$taskPKIConfig = Join-Path $PSScriptRoot 'pki.cnf'
if (!(Test-Path -LiteralPath $taskOpenSSL)) { throw 'Git for Windows OpenSSL is required.' }
$taskSecretPath = [IO.Path]::GetFullPath($SecretDirectory)
if (Test-Path -LiteralPath $taskSecretPath) {
    if (!$Resume) { throw 'Secret directory already exists; refusing credential overwrite.' }
} else { New-Item -ItemType Directory -Path $taskSecretPath | Out-Null }
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $taskSecretPath /inheritance:r /grant:r "${taskIdentity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict secret directory ACL.' }
function Invoke-OpenSSL([string[]]$Arguments) {
    & $taskOpenSSL @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'OpenSSL failed; do not use the partial credential set.' }
}
Push-Location -LiteralPath $taskSecretPath
try {
    if (!$Resume) {
        Invoke-OpenSSL @('req','-config',$taskPKIConfig,'-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout','ca.key','-out','ca.crt','-days','3650','-subj','/CN=HAPI Tunnel Private CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign','-addext','subjectKeyIdentifier=hash')
    } elseif (!(Test-Path ca.key) -or !(Test-Path ca.crt)) { throw 'Resume requires the original CA key and certificate.' }
    foreach ($taskRole in @('server','client')) {
        $taskCN = if ($taskRole -eq 'server') { $ServerName } else { 'hapi-home-client' }
        $taskUsage = if ($taskRole -eq 'server') { 'serverAuth' } else { 'clientAuth' }
        $taskArgs = @('req','-config',$taskPKIConfig,'-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',"$taskRole.key",'-out',"$taskRole.csr",'-subj',"/CN=$taskCN",'-addext',"extendedKeyUsage=$taskUsage",'-addext','keyUsage=critical,digitalSignature','-addext','basicConstraints=critical,CA:FALSE')
        if ($taskRole -eq 'server') { $taskArgs += @('-addext',"subjectAltName=DNS:$ServerName") }
        if (Test-Path "$taskRole.crt") { throw 'Certificate already exists; use a deliberate rotation workflow.' }
        if (!(Test-Path "$taskRole.key") -and !(Test-Path "$taskRole.csr")) { Invoke-OpenSSL $taskArgs }
        elseif (!(Test-Path "$taskRole.key") -or !(Test-Path "$taskRole.csr")) { throw 'Incomplete key/CSR pair.' }
        $taskExtensions = "basicConstraints=critical,CA:FALSE`nextendedKeyUsage=$taskUsage`nkeyUsage=critical,digitalSignature`nsubjectKeyIdentifier=hash`nauthorityKeyIdentifier=keyid,issuer`n"
        if ($taskRole -eq 'server') { $taskExtensions += "subjectAltName=DNS:$ServerName`n" }
        [IO.File]::WriteAllText((Join-Path $taskSecretPath "$taskRole.ext"), $taskExtensions)
        Invoke-OpenSSL @('x509','-req','-in',"$taskRole.csr",'-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out',"$taskRole.crt",'-days','90','-sha256','-extfile',"$taskRole.ext")
    }
    [IO.File]::WriteAllText((Join-Path $taskSecretPath 'tunnel-token'), [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant())
    Invoke-OpenSSL @('verify','-CAfile','ca.crt','-purpose','sslserver','-verify_hostname',$ServerName,'server.crt')
    Invoke-OpenSSL @('verify','-CAfile','ca.crt','-purpose','sslclient','client.crt')
    Write-Output 'Generated and verified private-CA mutual-TLS credentials. Leaf certificates expire in 90 days. No secret values printed.'
} finally { Pop-Location }
