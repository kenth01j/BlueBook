$ErrorActionPreference = 'Stop'
$databaseName = 'bipsu_bluebook'

function Get-MongoUriParts {
    param([Parameter(Mandatory = $true)][string]$ConnectionString)

    $match = [regex]::Match(
        $ConnectionString,
        '^mongodb(?:\+srv)?://(?:[^/@]+@)?([^/?]+)(?:/([^?]*))?(?:\?.*)?$'
    )
    if (-not $match.Success) {
        throw 'A MongoDB connection URI is malformed.'
    }

    [pscustomobject]@{
        Host = $match.Groups[1].Value
        Database = [uri]::UnescapeDataString($match.Groups[2].Value)
    }
}

function Invoke-MongoTool {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    $output = & $Executable @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        throw "$FailureMessage (exit code $exitCode)."
    }
}

try {
    Write-Host 'This migrates the local bipsu_bluebook database to Atlas.'
    Write-Host 'It creates backups first and replaces matching Atlas collections only after confirmation.'
    Write-Host 'It does not migrate files stored outside MongoDB, such as locally stored payment proofs.'

    $passwordRotated = Read-Host 'Have you rotated the Atlas database password exposed in chat? Type YES to continue'
    if ($passwordRotated -cne 'YES') {
        throw 'Stop here. Rotate the exposed Atlas password before migrating.'
    }

    $toolDirectory = Read-Host 'Path to the MongoDB Database Tools bin folder (blank to use the current folder)'
    if ([string]::IsNullOrWhiteSpace($toolDirectory)) {
        $toolDirectory = (Get-Location).Path
    }

    $dumpExecutable = Join-Path $toolDirectory 'mongodump.exe'
    $restoreExecutable = Join-Path $toolDirectory 'mongorestore.exe'
    if (-not (Test-Path -LiteralPath $dumpExecutable -PathType Leaf)) {
        throw 'mongodump.exe was not found in the selected folder.'
    }
    if (-not (Test-Path -LiteralPath $restoreExecutable -PathType Leaf)) {
        throw 'mongorestore.exe was not found in the selected folder.'
    }

    $sourceUri = Read-Host 'Old local MongoDB URI (must be localhost or 127.0.0.1)'
    $atlasUri = Read-Host 'New, rotated Atlas URI for bipsu_bluebook'

    $source = Get-MongoUriParts -ConnectionString $sourceUri
    $target = Get-MongoUriParts -ConnectionString $atlasUri

    if ($source.Host -notmatch '^(localhost|127\.0\.0\.1)(:\d+)?$') {
        throw 'The source must be your local MongoDB host (localhost or 127.0.0.1), not Atlas.'
    }
    if ($target.Host -notmatch '\.mongodb\.net$') {
        throw 'The target URI must use your MongoDB Atlas host.'
    }
    if ($source.Database -ne $databaseName -or $target.Database -ne $databaseName) {
        throw "Both URIs must target the $databaseName database."
    }

    $documents = [Environment]::GetFolderPath('MyDocuments')
    if ([string]::IsNullOrWhiteSpace($documents)) {
        $documents = Join-Path $env:USERPROFILE 'Documents'
    }
    $backupRoot = Join-Path $documents ("BlueBookMigration-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    $atlasBackup = Join-Path $backupRoot 'atlas-before'
    $localBackup = Join-Path $backupRoot 'local-source'
    $atlasDatabaseBackup = Join-Path $atlasBackup $databaseName
    $localDatabaseBackup = Join-Path $localBackup $databaseName
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    Write-Host 'Checking MongoDB Database Tools...'
    Invoke-MongoTool -Executable $dumpExecutable -Arguments @('--version') -FailureMessage 'mongodump version check failed'
    Invoke-MongoTool -Executable $restoreExecutable -Arguments @('--version') -FailureMessage 'mongorestore version check failed'

    Write-Host 'Backing up the current Atlas database...'
    Invoke-MongoTool -Executable $dumpExecutable -Arguments @('--uri', $atlasUri, '--out', $atlasBackup) -FailureMessage 'Atlas backup failed'
    if (-not (Test-Path -LiteralPath $atlasDatabaseBackup -PathType Container)) {
        throw 'The Atlas backup folder was not created. Verify the target URI and database; nothing was restored.'
    }

    Write-Host 'Backing up the old local database...'
    Invoke-MongoTool -Executable $dumpExecutable -Arguments @('--uri', $sourceUri, '--out', $localBackup) -FailureMessage 'Local database backup failed'
    if (-not (Test-Path -LiteralPath $localDatabaseBackup -PathType Container)) {
        throw 'The local backup folder was not created. Verify the source URI; nothing was restored.'
    }

    $localCollections = @(Get-ChildItem -LiteralPath $localDatabaseBackup -Filter '*.bson' -File)
    if ($localCollections.Count -eq 0) {
        throw 'The local backup contains no BSON collections; nothing was restored.'
    }

    Write-Host "Local collections found: $($localCollections.BaseName -join ', ')"
    Write-Host "Backups are stored at: $backupRoot"
    Write-Warning 'The next step replaces matching collections in Atlas with the local copies.'
    $confirmation = Read-Host 'Type RESTORE LOCAL DATA to proceed'
    if ($confirmation -cne 'RESTORE LOCAL DATA') {
        Write-Host 'Cancelled. Both backups were kept; Atlas was not changed.'
        return
    }

    Write-Host 'Restoring local collections to Atlas...'
    try {
        Invoke-MongoTool -Executable $restoreExecutable -Arguments @('--uri', $atlasUri, '--drop', '--stopOnError', $localDatabaseBackup) -FailureMessage 'Local restore failed'
    }
    catch {
        Write-Warning 'The local restore failed. Attempting to restore the Atlas backup.'
        try {
            Invoke-MongoTool -Executable $restoreExecutable -Arguments @('--uri', $atlasUri, '--drop', '--stopOnError', $atlasDatabaseBackup) -FailureMessage 'Atlas rollback failed'
        }
        catch {
            throw "Migration or rollback failed. Do not redeploy or rerun yet. Keep the backups at $backupRoot and get help with the error."
        }
        throw "Migration failed; the prior Atlas data was restored. Keep the backups at $backupRoot."
    }

    Write-Host 'Migration completed successfully.'
    Write-Host 'Refresh the Render site and test the existing admin and cashier accounts.'
    Write-Host "Keep both backups until you have verified the site. Backup folder: $backupRoot"
}
finally {
    $sourceUri = $null
    $atlasUri = $null
}
