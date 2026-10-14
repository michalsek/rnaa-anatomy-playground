#!/bin/sh
# M12: the final video, the loop then the outro (notes/M12.md). Usage: tools/film/final.sh <dir>
# Needs <dir>/p1.mkv, <dir>/tail.mkv (composite.py), <dir>/outro.mkv (outro.py). The loop part is
# encoded exactly as loop.sh does (the same key frames and the dissolve's quantiser); one more key
# frame where the outro begins. loop-light-60.mp4 is not touched.
set -eu
D=$1
XF=30
P1N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/p1.mkv")
TN=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/tail.mkv")
CUT=$((P1N - XF))
DIS=$((CUT + TN - XF))
OUT=$((CUT + TN))
ffmpeg -v error -y -i "$D/p1.mkv" -i "$D/tail.mkv" -i "$D/outro.mkv" -filter_complex "
 [0:v]trim=start_frame=$XF,setpts=PTS-STARTPTS[a];
 [a][1:v][2:v]concat=n=3:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]" -map "[v]" \
 -c:v libx264 -profile:v high -level 4.2 -preset slow -crf 16 -maxrate 20M -bufsize 40M \
 -x264-params "zones=$DIS,$((DIS + XF - 1)),q=10" \
 -r 60 -g 120 -force_key_frames "expr:eq(n,$CUT)+eq(n,$DIS)+eq(n,$OUT)" -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart -an "$D/final-light-60.mp4"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,duration -of default=nw=1 "$D/final-light-60.mp4"
ls -l "$D/final-light-60.mp4"
