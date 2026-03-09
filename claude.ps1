param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ArgsList
)

$native = Join-Path $env:USERPROFILE ".local\\bin\\claude.exe"

if (Test-Path $native) {
  & $native @ArgsList
  exit $LASTEXITCODE
}

# Fallback to npm-installed CLI (works even if native isn't installed / PATH not set)
& npx claude @ArgsList
exit $LASTEXITCODE

