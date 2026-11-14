using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;

namespace CapCut2.Windows;

/// <summary>
/// Portable update mechanism using this project's GitHub Releases.
/// Installs only after confirmation, with a SHA-256 integrity check.
/// Run from a writable extracted directory, not a protected system folder.
/// </summary>
internal static class UpdateService
{
    private const string ReleasesApi =
        "https://api.github.com/repos/raphaelsancho21-byte/capcutlite/releases/latest";
    private const string ReleasesPage =
        "https://github.com/raphaelsancho21-byte/capcutlite/releases/latest";
    private const string PackageName = "CapCut2-Windows.zip";
    private const string DigestName = "CapCut2-Windows.sha256";
    private static readonly HttpClient Http = NewClient();

    private static HttpClient NewClient()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromMinutes(6) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("CapCut2-Windows-Updater/1.1");
        h.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return h;
    }

    internal static async Task CheckAsync(Window owner, bool silent)
    {
        try
        {
            using var response = await Http.GetAsync(ReleasesApi);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                if (!silent)
                    MessageBox.Show(owner,
                        "Ainda não existe uma versão publicada em Releases.\n" +
                        "O botão de atualização começará a funcionar após a primeira publicação.",
                        "CapCut 2 • Atualizações", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            response.EnsureSuccessStatusCode();

            using var data = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var release = data.RootElement;
            var tag = release.GetProperty("tag_name").GetString() ?? "";
            if (!Version.TryParse(tag.TrimStart('v', 'V'), out var latest))
                throw new InvalidDataException("Versão da Release inválida.");

            var current = typeof(UpdateService).Assembly.GetName().Version ?? new Version(1, 1, 0);
            if (latest <= current)
            {
                if (!silent)
                    MessageBox.Show(owner, "Você já está na versão mais recente (" + current + ").",
                        "CapCut 2 • Atualizações", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var assets = release.GetProperty("assets").EnumerateArray().ToArray();
            string? zipUrl = FindAsset(assets, PackageName);
            string? shaUrl = FindAsset(assets, DigestName);
            if (zipUrl == null || shaUrl == null)
            {
                if (!silent)
                    MessageBox.Show(owner, "A versão " + tag +
                        " ainda não tem um pacote de instalação verificável. Abra o GitHub Releases.",
                        "CapCut 2 • Atualizações", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var answer = MessageBox.Show(owner,
                "Nova versão disponível: " + tag + "\n" +
                "Versão instalada: " + current + "\n\n" +
                "Baixar e instalar agora?\nO editor será fechado e reaberto após a atualização.\n" +
                "Salve qualquer trabalho antes de continuar.",
                "CapCut 2 • Atualização disponível", MessageBoxButton.YesNo,
                MessageBoxImage.Question);
            if (answer != MessageBoxResult.Yes) return;

            await InstallAsync(owner, zipUrl, shaUrl);
        }
        catch (Exception ex)
        {
            if (!silent)
                MessageBox.Show(owner, "Não foi possível verificar as atualizações:\n" + ex.Message +
                    "\n\nVocê também pode baixar a nova versão em:\n" + ReleasesPage,
                    "CapCut 2 • Atualizações", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private static string? FindAsset(JsonElement[] assets, string name)
    {
        foreach (var item in assets)
            if (string.Equals(item.GetProperty("name").GetString(), name,
                    StringComparison.OrdinalIgnoreCase))
                return item.GetProperty("browser_download_url").GetString();
        return null;
    }

    private static async Task InstallAsync(Window owner, string archiveUrl, string shaUrl)
    {
        var folder = Path.Combine(Path.GetTempPath(), "CapCut2-Update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var zipPath = Path.Combine(folder, PackageName);
        var staging = Path.Combine(folder, "files");
        try
        {
            using (var stream = await Http.GetStreamAsync(archiveUrl))
            using (var file = File.Create(zipPath))
                await stream.CopyToAsync(file);
            string reference = (await Http.GetStringAsync(shaUrl)).Trim().Split(' ', '\t', '\r', '\n')[0];
            string actual;
            using (var file = File.OpenRead(zipPath))
                actual = Convert.ToHexString(await SHA256.HashDataAsync(file));
            if (reference.Length != 64 ||
                !string.Equals(actual, reference, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("A verificação SHA-256 do pacote falhou. Atualização cancelada.");

            ZipFile.ExtractToDirectory(zipPath, staging);
            if (!File.Exists(Path.Combine(staging, "CapCut2.exe")) ||
                !File.Exists(Path.Combine(staging, "ffmpeg.exe")))
                throw new InvalidDataException("O pacote não contém os executáveis esperados.");

            string target = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string app = Path.Combine(target, "CapCut2.exe");
            if (!File.Exists(app)) throw new IOException("O executável instalado não foi encontrado.");
            string script = Path.Combine(folder, "apply-update.ps1");
            File.WriteAllText(script, UpdateScript, new UTF8Encoding(false));

            var start = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            start.ArgumentList.Add("-NoProfile");
            start.ArgumentList.Add("-ExecutionPolicy");
            start.ArgumentList.Add("Bypass");
            start.ArgumentList.Add("-File");
            start.ArgumentList.Add(script);
            start.ArgumentList.Add("-OldPid");
            start.ArgumentList.Add(Process.GetCurrentProcess().Id.ToString());
            start.ArgumentList.Add("-Source");
            start.ArgumentList.Add(staging);
            start.ArgumentList.Add("-Destination");
            start.ArgumentList.Add(target);
            start.ArgumentList.Add("-AppPath");
            start.ArgumentList.Add(app);

            if (Process.Start(start) == null)
                throw new IOException("Não foi possível abrir o instalador da atualização.");

            MessageBox.Show(owner,
                "Pacote verificado. O CapCut 2 será fechado e atualizado.\n" +
                "Se o Windows bloquear a gravação na pasta de instalação, extraia o app para uma pasta sua.",
                "CapCut 2 • Atualização", MessageBoxButton.OK, MessageBoxImage.Information);
            Application.Current.Shutdown();
        }
        catch
        {
            try { Directory.Delete(folder, recursive: true); } catch { }
            throw;
        }
    }

    private const string UpdateScript = """
param(
 [int]$OldPid,
 [string]$Source,
 [string]$Destination,
 [string]$AppPath
)
$ErrorActionPreference = 'Stop'
try {
    try { Wait-Process -Id $OldPid -Timeout 60 -ErrorAction Stop } catch { }
    Start-Sleep -Milliseconds 600
    Copy-Item -LiteralPath (Join-Path $Source 'CapCut2.exe') -Destination (Join-Path $Destination 'CapCut2.exe') -Force
    Copy-Item -LiteralPath (Join-Path $Source 'ffmpeg.exe') -Destination (Join-Path $Destination 'ffmpeg.exe') -Force
    Start-Process -FilePath $AppPath -WorkingDirectory $Destination
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Falha ao atualizar o CapCut 2: " + $_.Exception.Message, "CapCut 2")
}
""";
}
