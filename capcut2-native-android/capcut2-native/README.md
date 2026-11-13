# CapCut 2 Native — Android real, sem Capacitor

Este é um **novo aplicativo Android nativo**, não o antigo HTML convertido para WebView. Desenvolvido em Java, usa controles nativos e as APIs Android `VideoView`, `MediaExtractor`, `MediaMuxer`, Storage Access Framework. Sem rede e sem dependências de UI externas.

## Recursos desta base
- Importar vídeos pelo seletor nativo de arquivos/galeria do Android.
- Prévia via decodificação do sistema, play/pause e barra de busca.
- Marcar início/fim de um corte com precisão de milissegundos nos campos.
- Marcar manualmente instantes de batidas (lista simples, não há waveform nem detecção automática).
- Exportar vídeo MP4 rapidamente **sem recodificar**, opcionalmente removendo a faixa de áudio original.
- Salvar em pasta escolhida pelo usuário.

## Limitações importantes
- **Não é uma conversão integral da V5**: timeline multipista, Free Transform, músicas extras, transições, waveform e encaixe magnético ainda não estão presentes.
- Corte MP4 por remux pode começar no quadro-chave anterior ao solicitado; é necessário transcodificar para cortes exatos por frame.
- Não é possível trocar resolução/bitrate sem implementar transcodificação por MediaCodec. A exportação mantém a qualidade original.
- O suporte aos codecs depende da mídia original e dos codecs aceitos pelo `MediaMuxer` do Android.
- Essa base ainda não foi compilada ou testada em um aparelho Android neste ambiente; o workflow pode precisar de correções conforme os logs.

## Como compilar na nuvem
Envie **o conteúdo extraído desta pasta para a raiz** de um repositório GitHub (não envie só o ZIP), vá a Actions > "Criar APK Nativo do CapCut 2" > Run workflow. Ao concluir, abra a execução e baixe o artefato `CapCut2-Native-APK`.

Atenção: não use o workflow Capacitor antigo para esse repositório. O projeto nativo usa Gradle direto.
