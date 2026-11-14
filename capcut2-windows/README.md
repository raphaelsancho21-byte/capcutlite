# CapCut 2 Windows — executável nativo

Esta pasta é a versão **Windows .exe**, separada da base **Android .apk** em `capcut2-native-android/capcut2-native/`. Ambas estão no mesmo repositório e não usam Capacitor.

## Recursos Windows iniciais
- Importação de vídeos locais, reprodução com MediaElement (Windows Media Foundation), play/pause e busca.
- Timeline simples com cursor fixo; busca ao soltar o mouse e atualizações de 200 ms apenas durante reprodução.
- Marcadores de batida manuais, limites de corte e visualização de duração.
- Ajustar / preencher / esticar *a prévia* (não altera o arquivo exportado).
- Exportação MP4 por remux de FFmpeg, preservando qualidade original sem recodificar, com opção de remover áudio. Precisa manter `ffmpeg.exe` junto do `CapCut2.exe`.

## Limitações
- Esta versão desktop ainda **não** traz timeline multipista, extração separada de áudio, keyframes, Free Transform nem detecção automática de batidas.
- A busca e o corte por remux não são precisos por frame: o corte pode começar no keyframe anterior.
- A prévia usa os codecs de mídia instalados no Windows; alguns formatos não abrem.
- Exportação MP4 requer codecs de origem compatíveis com contêiner MP4.
- As opções de encaixe/esticar mudam **apenas a prévia**, não o vídeo exportado.
- O código ainda precisa passar pela compilação do GitHub Actions e ser testado em Windows real.

## Como gerar os dois aplicativos
- Windows: Actions > **Criar EXE Windows do CapCut 2** > Run workflow; baixe **CapCut2-Windows-EXE**. Extraia o ZIP e execute `CapCut2.exe` mantendo `ffmpeg.exe` na mesma pasta.
- Android: Actions > **Criar APK Nativo do CapCut 2** > Run workflow; baixe **CapCut2-Nativo-Light-APK** e instale o APK extraído no telefone.

Recomendação: no Windows, caso o SmartScreen apareça, verifique se o executável foi gerado pelo seu repositório. O aplicativo não é assinado digitalmente.
