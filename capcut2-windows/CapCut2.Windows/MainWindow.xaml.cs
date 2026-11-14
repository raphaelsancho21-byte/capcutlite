using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace CapCut2.Windows;

public partial class MainWindow : Window
{
    private readonly DispatcherTimer playbackTimer;
    private readonly List<TimeSpan> beats = new();
    private string? sourceFile;
    private bool dragging;
    private bool updatingTimeline;
    private bool playing;
    private bool exporting;
    private TimeSpan duration = TimeSpan.Zero;

    public MainWindow()
    {
        InitializeComponent();
        playbackTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        playbackTimer.Tick += (_, _) => UpdatePlayback();
        Closing += (_, _) => { playbackTimer.Stop(); Player.Stop(); };
        SizeChanged += (_, _) => RefreshTrackPreview();
        Loaded += async (_, _) => await UpdateService.CheckAsync(this, silent: true);
    }

    private static string TimeLabel(TimeSpan position) =>
        $"{(int)position.TotalMinutes:00}:{position.Seconds:00}.{position.Milliseconds:000}";

    private void Status(string text) => StatusText.Text = text;

    private void Open_Click(object sender, RoutedEventArgs e)
    {
        var picker = new OpenFileDialog
        {
            Title = "Escolha um vídeo",
            Filter = "Vídeos|*.mp4;*.mov;*.m4v;*.wmv;*.avi;*.webm;*.mkv|Todos os arquivos|*.*"
        };
        if (picker.ShowDialog() != true) return;
        playbackTimer.Stop();
        Player.Stop();
        playing = false;
        PlayButton.Content = "▶ Reproduzir";
        beats.Clear();
        UpdateBeats();
        sourceFile = picker.FileName;
        duration = TimeSpan.Zero;
        MediaName.Text = Path.GetFileName(sourceFile);
        MediaList.Items.Clear();
        MediaList.Items.Add(Path.GetFileName(sourceFile));
        ClipText.Text = Path.GetFileName(sourceFile);
        VideoTrackClip.Visibility = Visibility.Visible;
        AudioTrackClip.Visibility = Visibility.Visible;
        RefreshTrackPreview();
        EmptyHint.Visibility = Visibility.Collapsed;
        Player.Source = new Uri(sourceFile);
        Status("Abrindo vídeo...");
    }

    private void Player_MediaOpened(object sender, RoutedEventArgs e)
    {
        if (!Player.NaturalDuration.HasTimeSpan)
        {
            Status("Não foi possível obter a duração do vídeo.");
            return;
        }
        duration = Player.NaturalDuration.TimeSpan;
        RefreshTrackPreview();
        StartBox.Text = "0.000";
        EndBox.Text = duration.TotalSeconds.ToString("F3", CultureInfo.InvariantCulture);
        Timeline.Maximum = duration.TotalMilliseconds;
        Timeline.Value = 0;
        Player.Pause();
        RefreshClock();
        Status("Vídeo carregado. Use Reproduzir ou mova a timeline.");
    }

    private void Player_MediaFailed(object sender, ExceptionRoutedEventArgs e)
    {
        Status("O Windows não conseguiu abrir este codec: " + e.ErrorException.Message);
    }

    private void Player_MediaEnded(object sender, RoutedEventArgs e)
    {
        StopPlaying();
        Player.Position = TimeSpan.Zero;
        RefreshClock();
    }

    private void Play_Click(object sender, RoutedEventArgs e)
    {
        if (sourceFile == null || duration == TimeSpan.Zero) return;
        if (playing) { Player.Pause(); StopPlaying(); }
        else
        {
            if (Player.Position >= duration - TimeSpan.FromMilliseconds(50))
                Player.Position = TimeSpan.Zero;
            Player.Play();
            playing = true;
            PlayButton.Content = "❚❚ Pausar";
            playbackTimer.Start();
        }
    }

    private void StopPlaying()
    {
        playing = false;
        PlayButton.Content = "▶ Reproduzir";
        playbackTimer.Stop();
    }

    private void UpdatePlayback()
    {
        if (!playing || dragging) return;
        updatingTimeline = true;
        Timeline.Value = Math.Min(duration.TotalMilliseconds, Player.Position.TotalMilliseconds);
        updatingTimeline = false;
        RefreshClock();
    }

    private void RefreshClock()
    {
        ClockText.Text = TimeLabel(Player.Position) + " / " + TimeLabel(duration);
    }

    private void Timeline_MouseDown(object sender, MouseButtonEventArgs e) => dragging = true;
    private void Timeline_MouseUp(object sender, MouseButtonEventArgs e)
    {
        if (!dragging) return;
        dragging = false;
        Seek(TimeSpan.FromMilliseconds(Timeline.Value));
    }

    private void Timeline_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (ClockText == null || Player == null || updatingTimeline) return;
        if (dragging) ClockText.Text =
            TimeLabel(TimeSpan.FromMilliseconds(Math.Max(0,Timeline.Value))) + " / " + TimeLabel(duration);
    }

    private void Seek(TimeSpan target)
    {
        if (sourceFile == null || duration == TimeSpan.Zero) return;
        if (target < TimeSpan.Zero) target = TimeSpan.Zero;
        if (target > duration) target = duration;
        Player.Position = target;
        updatingTimeline = true;
        Timeline.Value = target.TotalMilliseconds;
        updatingTimeline = false;
        RefreshClock();
    }

    private void Back_Click(object sender, RoutedEventArgs e) => Seek(Player.Position - TimeSpan.FromSeconds(1));
    private void Forward_Click(object sender, RoutedEventArgs e) => Seek(Player.Position + TimeSpan.FromSeconds(1));

    private void Start_Click(object sender, RoutedEventArgs e) =>
        StartBox.Text = Player.Position.TotalSeconds.ToString("F3", CultureInfo.InvariantCulture);
    private void End_Click(object sender, RoutedEventArgs e) =>
        EndBox.Text = Player.Position.TotalSeconds.ToString("F3", CultureInfo.InvariantCulture);

    private void Beat_Click(object sender, RoutedEventArgs e)
    {
        if (sourceFile == null) return;
        beats.Add(Player.Position);
        beats.Sort();
        UpdateBeats();
    }

    private void ClearBeats_Click(object sender, RoutedEventArgs e)
    {
        beats.Clear();
        UpdateBeats();
    }

    private void UpdateBeats()
    {
        BeatsText.Text = beats.Count == 0 ? "Nenhuma batida marcada" :
            $"Batidas ({beats.Count}): " +
            string.Join("  ·  ", beats.Take(7).Select(TimeLabel)) +
            (beats.Count > 7 ? " ..." : "");
    }

    private void FitChoice_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (Player == null || FitChoice == null) return;
        Player.Stretch = FitChoice.SelectedIndex switch
        {
            1 => Stretch.UniformToFill,
            2 => Stretch.Fill,
            _ => Stretch.Uniform
        };
    }

    private bool TryGetTrim(out double start, out double end)
    {
        var inv = CultureInfo.InvariantCulture;
        var a = (StartBox.Text ?? "").Replace(',', '.');
        var b = (EndBox.Text ?? "").Replace(',', '.');
        bool startValid = double.TryParse(a, NumberStyles.Float, inv, out start);
        bool endValid = double.TryParse(b, NumberStyles.Float, inv, out end);
        bool ok = startValid && endValid && start >= 0
                && end > start && end <= duration.TotalSeconds + 0.01;
        if (!ok) Status("Corte inválido: confira os segundos de início e fim.");
        return ok;
    }

    private async void Export_Click(object sender, RoutedEventArgs e)
    {
        if (exporting || sourceFile == null || duration == TimeSpan.Zero) return;
        if (!TryGetTrim(out double start, out double end)) return;
        string bundled = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
        string ffmpeg = File.Exists(bundled) ? bundled : "ffmpeg";
        if (!File.Exists(bundled) && !CanFindFfmpeg())
        {
            Status("FFmpeg não encontrado. Use o ZIP do GitHub contendo CapCut2.exe e ffmpeg.exe juntos.");
            return;
        }
        var dialog = new SaveFileDialog
        {
            Title = "Salvar MP4",
            Filter = "Vídeo MP4|*.mp4",
            FileName = Path.GetFileNameWithoutExtension(sourceFile) + "-editado.mp4",
            DefaultExt = ".mp4",
            AddExtension = true
        };
        if (dialog.ShowDialog() != true) return;
        Player.Pause();
        StopPlaying();
        exporting = true;
        Status("Exportando MP4... Não feche o aplicativo.");
        try
        {
            string input = sourceFile;
            string output = dialog.FileName;
            bool keepAudio = KeepAudio.IsChecked == true;
            var result = await Task.Run(() => ExportWithFfmpeg(ffmpeg, input, output, start, end, keepAudio));
            Status(result == 0 ? "MP4 exportado: " + Path.GetFileName(output)
                               : "Falha na exportação (código " + result + "). Verifique o formato do vídeo.");
        }
        catch (Exception ex)
        {
            Status("Erro na exportação: " + ex.Message);
        }
        finally { exporting = false; }
    }

    private static bool CanFindFfmpeg()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("ffmpeg", "-version")
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            });
            if (p == null) return false;
            p.WaitForExit(3000);
            return p.HasExited && p.ExitCode == 0;
        }
        catch { return false; }
    }

    private static int ExportWithFfmpeg(string executable, string input, string output,
        double start, double end, bool audio)
    {
        var info = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true
        };
        var inv = CultureInfo.InvariantCulture;
        info.ArgumentList.Add("-hide_banner");
        info.ArgumentList.Add("-loglevel");
        info.ArgumentList.Add("error");
        info.ArgumentList.Add("-y");
        info.ArgumentList.Add("-ss");
        info.ArgumentList.Add(start.ToString("F3", inv));
        info.ArgumentList.Add("-i");
        info.ArgumentList.Add(input);
        info.ArgumentList.Add("-t");
        info.ArgumentList.Add((end - start).ToString("F3", inv));
        info.ArgumentList.Add("-map");
        info.ArgumentList.Add("0:v:0");
        if (audio)
        {
            info.ArgumentList.Add("-map");
            info.ArgumentList.Add("0:a?");
        }
        info.ArgumentList.Add("-c");
        info.ArgumentList.Add("copy");
        info.ArgumentList.Add("-avoid_negative_ts");
        info.ArgumentList.Add("make_zero");
        info.ArgumentList.Add(output);
        using var process = Process.Start(info)
            ?? throw new InvalidOperationException("Não foi possível iniciar FFmpeg.");
        string errors = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException(errors.Length > 500 ? errors[..500] : errors);
        return process.ExitCode;
    }
    private void MediaList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sourceFile == null || MediaList.SelectedIndex < 0) return;
        Status("Mídia selecionada: " + Path.GetFileName(sourceFile));
    }

    private void RefreshTrackPreview()
    {
        if (VideoTrackClip == null || AudioTrackClip == null) return;
        double available = Math.Max(0, ActualWidth - 690);
        if (available < 120) available = 360;
        VideoTrackClip.Width = available;
        AudioTrackClip.Width = available;
    }

    private async void CheckUpdates_Click(object sender, RoutedEventArgs e)
    {
        UpdateButton.IsEnabled = false;
        try { await UpdateService.CheckAsync(this, silent: false); }
        finally { UpdateButton.IsEnabled = true; }
    }

}
