$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root '.downloads'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'download-local-models.log'

function Write-Log($message) {
  $line = "$(Get-Date -Format o) $message"
  Add-Content -Path $log -Value $line
  Write-Host $line
}

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(30)

function Download-Verify([string]$Url, [string]$Path, [long]$ExpectedBytes, [string]$ExpectedSha) {
  $attempt = 0
  while ($true) {
    $attempt += 1
    $length = 0
    if (Test-Path $Path) { $length = (Get-Item $Path).Length }
    if ($length -eq $ExpectedBytes) {
      if ([string]::IsNullOrWhiteSpace($ExpectedSha)) { Write-Log "VERIFIED SIZE $Path ($length bytes)"; return }
      $hash = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($hash -eq $ExpectedSha) { Write-Log "VERIFIED $Path ($length bytes)"; return }
      Write-Log "BAD HASH ${Path}: $hash; restarting"
      Remove-Item $Path -Force
      $length = 0
    }
    if ($length -gt $ExpectedBytes) {
      Write-Log "OVERSIZE $Path ($length); restarting"
      Remove-Item $Path -Force
      $length = 0
    }
    Write-Log "DOWNLOAD attempt $attempt $Path from offset $length / $ExpectedBytes"
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Url)
    if ($length -gt 0) {
      $request.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::new($length, $null)
    }
    $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if ($length -gt 0 -and [int]$response.StatusCode -ne 206) {
      Write-Log "Server ignored Range ($([int]$response.StatusCode)); restarting file"
      $response.Dispose()
      Remove-Item $Path -Force
      continue
    }
    if (-not $response.IsSuccessStatusCode -and [int]$response.StatusCode -ne 206) {
      $response.Dispose()
      throw "Download failed with HTTP $([int]$response.StatusCode)"
    }
    $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $mode = if ($length -gt 0) { [System.IO.FileMode]::Append } else { [System.IO.FileMode]::Create }
    $target = [System.IO.File]::Open($Path, $mode, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    try {
      $buffer = New-Object byte[] 1048576
      while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $target.Write($buffer, 0, $read)
      }
    } finally {
      $target.Dispose()
      $source.Dispose()
      $response.Dispose()
    }
  }
}

try {
  $modelDir = Join-Path $root 'models\llm'
  New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

  Download-Verify `
    'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true' `
    (Join-Path $modelDir 'qwen2.5-1.5b-instruct-q4_k_m.gguf') `
    1117320736 `
    '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'

  Download-Verify `
    'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-Q4_K_M.gguf?download=true' `
    (Join-Path $modelDir 'all-MiniLM-L6-v2-Q4_K_M.gguf') `
    20999104 `
    ''

  Write-Log 'ALL_MODELS_READY'
} catch {
  Write-Log "FAILED $($_.Exception.Message)"
  throw
}
