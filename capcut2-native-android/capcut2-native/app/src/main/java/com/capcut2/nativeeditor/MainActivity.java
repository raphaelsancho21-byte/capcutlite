package com.capcut2.nativeeditor;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native implementation: no WebView, no Capacitor, no internet permission. */
public class MainActivity extends Activity {
    private static final int PICK_VIDEO=101, SAVE_MP4=102;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final ArrayList<Long> beats=new ArrayList<>();
    private Uri videoUri;
    private VideoView preview;
    private SeekBar timeline;
    private TextView state, clock, trimLabel, beatsLabel;
    private EditText startField,endField;
    private CheckBox keepSound;
    private long durationMs=0, startMs=0, endMs=0;
    private boolean touching=false;
    private final Runnable tick=new Runnable(){@Override public void run(){
        if(preview!=null && videoUri!=null && !touching){
            int position=preview.getCurrentPosition();
            if(endMs>0 && position>=endMs && preview.isPlaying()){ preview.pause(); preview.seekTo((int)startMs); position=(int)startMs; }
            timeline.setProgress(position); clock.setText(format(position)+" / "+format(durationMs));
        }
        main.postDelayed(this,100);
    }};

    @Override public void onCreate(Bundle saved){super.onCreate(saved); makeUi(); main.post(tick);}
    @Override protected void onDestroy(){main.removeCallbacks(tick); io.shutdown(); super.onDestroy();}
    private int dp(float v){return (int)(getResources().getDisplayMetrics().density*v+.5f);}
    private TextView label(String text, int size){TextView t=new TextView(this); t.setText(text); t.setTextColor(Color.WHITE);t.setTextSize(size);t.setPadding(dp(6),dp(6),dp(6),dp(6));return t;}
    private Button button(String text){Button b=new Button(this);b.setText(text);b.setAllCaps(false);return b;}
    private EditText numeric(){EditText e=new EditText(this); e.setSingleLine(true); e.setInputType(8194);e.setTextColor(Color.WHITE);e.setTextSize(14);return e;}
    private void add(LinearLayout root,View view){root.addView(view,new LinearLayout.LayoutParams(-1,-2));}
    private void makeUi(){
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xff12141b);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(12),dp(12),dp(12),dp(20));scroll.addView(root);setContentView(scroll);
        TextView title=label("CapCut 2  ·  NATIVE",22);title.setGravity(Gravity.CENTER);add(root,title);
        TextView hint=label("Editor leve • galeria • cortes • MP4",13);hint.setGravity(Gravity.CENTER);hint.setTextColor(0xffa3afbf);add(root,hint);
        Button open=button("Importar vídeo da galeria");add(root,open);open.setOnClickListener(v->pickVideo());
        preview=new VideoView(this);preview.setBackgroundColor(Color.BLACK);
        LinearLayout.LayoutParams videoLayout=new LinearLayout.LayoutParams(-1,dp(225));videoLayout.topMargin=dp(9);root.addView(preview,videoLayout);
        preview.setOnPreparedListener(mp->{mp.setLooping(false);mp.setVolume(1,1);preview.seekTo((int)startMs);status("Vídeo carregado. Pronto para editar.");});
        clock=label("00:00.000 / 00:00.000",13);clock.setGravity(Gravity.CENTER);add(root,clock);
        timeline=new SeekBar(this);timeline.setMax(1);add(root,timeline);
        timeline.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onStartTrackingTouch(SeekBar b){touching=true;}public void onProgressChanged(SeekBar b,int value,boolean user){if(user && videoUri!=null){clock.setText(format(value)+" / "+format(durationMs));preview.seekTo(value);}}public void onStopTrackingTouch(SeekBar b){touching=false;}});
        LinearLayout controls=new LinearLayout(this);controls.setOrientation(LinearLayout.HORIZONTAL);add(root,controls);
        Button play=button("▶ Reproduzir");Button pause=button("❚❚ Pausar");controls.addView(play,new LinearLayout.LayoutParams(0,-2,1));controls.addView(pause,new LinearLayout.LayoutParams(0,-2,1));
        play.setOnClickListener(v->{if(videoUri!=null){if(preview.getCurrentPosition()>=endMs)preview.seekTo((int)startMs);preview.start();}});
        pause.setOnClickListener(v->preview.pause());
        trimLabel=label("Cortar trecho (segundos)",17);add(root,trimLabel);
        LinearLayout cuts=new LinearLayout(this);cuts.setOrientation(LinearLayout.HORIZONTAL);add(root,cuts);
        startField=numeric();endField=numeric();startField.setHint("Início (s)");endField.setHint("Fim (s)");cuts.addView(startField,new LinearLayout.LayoutParams(0,-2,1));cuts.addView(endField,new LinearLayout.LayoutParams(0,-2,1));
        Button markStart=button("Início = cursor");Button markEnd=button("Fim = cursor");add(root,markStart);add(root,markEnd);
        markStart.setOnClickListener(v->{if(videoUri!=null){startMs=Math.min(preview.getCurrentPosition(),endMs-1);refreshCuts();}});
        markEnd.setOnClickListener(v->{if(videoUri!=null){endMs=Math.max(preview.getCurrentPosition(),startMs+1);refreshCuts();}});
        Button apply=button("Aplicar limites de corte");add(root,apply);apply.setOnClickListener(v->applyCuts());
        keepSound=new CheckBox(this);keepSound.setText("Manter áudio original no MP4");keepSound.setTextColor(Color.WHITE);keepSound.setChecked(true);add(root,keepSound);
        Button beat=button("Marcar batida no cursor");add(root,beat);beat.setOnClickListener(v->{if(videoUri!=null){beats.add((long)preview.getCurrentPosition());refreshBeats();}});
        beatsLabel=label("Batidas: nenhuma",12);beatsLabel.setTextColor(0xffa3afbf);add(root,beatsLabel);
        Button clear=button("Limpar marcadores");add(root,clear);clear.setOnClickListener(v->{beats.clear();refreshBeats();});
        Button save=button("Exportar trecho MP4");add(root,save);save.setOnClickListener(v->{if(videoUri!=null && applyCuts()){Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("video/mp4");intent.putExtra(Intent.EXTRA_TITLE,"CapCut2-Editado.mp4");startActivityForResult(intent,SAVE_MP4);}});
        state=label("Selecione um vídeo para começar.",13);state.setTextColor(0xff8de4b8);add(root,state);
        TextView note=label("Nativo Android: usa VideoView, MediaExtractor e MediaMuxer. Exportação sem recodificar (corte aproximado ao keyframe). Não é ainda a timeline multipista da versão web.",12);note.setTextColor(0xff8f9baa);add(root,note);
    }
    private void status(String s){state.setText(s);}
    private String format(long t){long s=t/1000;return String.format(Locale.US,"%02d:%02d.%03d",s/60,s%60,t%1000);}
    private void refreshCuts(){startField.setText(String.format(Locale.US,"%.3f",startMs/1000d));endField.setText(String.format(Locale.US,"%.3f",endMs/1000d));trimLabel.setText("Corte: "+format(startMs)+" — "+format(endMs));}
    private void refreshBeats(){StringBuilder s=new StringBuilder("Batidas ("+beats.size()+"): ");for(int i=0;i<Math.min(beats.size(),12);i++)s.append(format(beats.get(i))).append("  ");beatsLabel.setText(s.toString());}
    private boolean applyCuts(){try{long a=(long)(Double.parseDouble(startField.getText().toString().replace(',','.'))*1000),b=(long)(Double.parseDouble(endField.getText().toString().replace(',','.'))*1000);if(a<0||b<=a||b>durationMs){status("Intervalo inválido.");return false;}startMs=a;endMs=b;refreshCuts();preview.seekTo((int)startMs);return true;}catch(Exception ex){status("Confira os números do início e fim.");return false;}}
    private void pickVideo(){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("video/*");intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(intent,PICK_VIDEO);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;
        if(request==PICK_VIDEO){try{videoUri=data.getData();getContentResolver().takePersistableUriPermission(videoUri,Intent.FLAG_GRANT_READ_URI_PERMISSION);MediaMetadataRetriever mmr=new MediaMetadataRetriever();mmr.setDataSource(this,videoUri);String d=mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);durationMs=Long.parseLong(d);mmr.release();startMs=0;endMs=durationMs;beats.clear();refreshBeats();refreshCuts();timeline.setMax((int)Math.min(durationMs,Integer.MAX_VALUE));preview.setVideoURI(videoUri);preview.requestFocus();status("Abrindo vídeo nativo...");}catch(Exception ex){status("Falha ao abrir mídia: "+ex.getMessage());}}
        if(request==SAVE_MP4){Uri destination=data.getData();long from=startMs*1000,to=endMs*1000;boolean audio=keepSound.isChecked();status("Exportando MP4...");io.execute(()->{try{export(destination,from,to,audio);main.post(()->status("MP4 exportado com sucesso!"));}catch(Exception ex){main.post(()->status("Erro na exportação: "+ex.getMessage()));}});}
    }
    /** Fast remux: retains original compression, avoiding expensive full-frame re-encoding. */
    private void export(Uri out,long startUs,long endUs,boolean audio) throws Exception {
        MediaExtractor extractor=new MediaExtractor();
        try(ParcelFileDescriptor source=getContentResolver().openFileDescriptor(videoUri,"r");ParcelFileDescriptor target=getContentResolver().openFileDescriptor(out,"rw")){
            if(source==null||target==null)throw new IllegalStateException("Não foi possível abrir os arquivos");
            extractor.setDataSource(source.getFileDescriptor());
            MediaMuxer muxer=new MediaMuxer(target.getFileDescriptor(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            try {
                int tracks=extractor.getTrackCount();int[] mapped=new int[tracks];
                int maxBuffer=1024*1024;
                for(int i=0;i<tracks;i++){
                    MediaFormat f=extractor.getTrackFormat(i);String mime=f.getString(MediaFormat.KEY_MIME);
                    boolean allowed=mime!=null&&(mime.startsWith("video/")||(audio && mime.startsWith("audio/")));
                    mapped[i]=allowed?muxer.addTrack(f):-1;
                    if(allowed){extractor.selectTrack(i);if(f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE))maxBuffer=Math.max(maxBuffer,f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));}
                }
                muxer.start();
                ByteBuffer buffer=ByteBuffer.allocateDirect(Math.min(Math.max(maxBuffer,1024*1024),16*1024*1024));
                MediaCodecBufferInfo info=new MediaCodecBufferInfo();
                extractor.seekTo(startUs,MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                long base=-1;long last=-1;
                while(true){int index=extractor.getSampleTrackIndex();if(index<0)break;long sampleTime=extractor.getSampleTime();if(sampleTime<0||sampleTime>endUs)break;
                    if(mapped[index]<0){extractor.advance();continue;}
                    // Include video sync frame before requested cut; audio after that keyframe is preserved.
                    if(base<0)base=sampleTime;
                    if(sampleTime<base){extractor.advance();continue;}
                    buffer.clear();int len=extractor.readSampleData(buffer,0);if(len<0)break;
                    info.info.offset=0;info.info.size=len;info.info.presentationTimeUs=Math.max(0,sampleTime-base);info.info.flags=(extractor.getSampleFlags()&MediaExtractor.SAMPLE_FLAG_SYNC)!=0?android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME:0;
                    // Some muxers require monotonic timestamps per track; extractor interleaving is expected.
                    muxer.writeSampleData(mapped[index],buffer,info.info);last=sampleTime;extractor.advance();
                }
                if(last<0)throw new IllegalStateException("Nenhuma amostra encontrada");
                muxer.stop();
            } finally {try{muxer.release();}catch(Exception ignored){}}
        }finally{extractor.release();}
    }
    private static class MediaCodecBufferInfo{final android.media.MediaCodec.BufferInfo info=new android.media.MediaCodec.BufferInfo();}
}
