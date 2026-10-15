#!/bin/sh
# M12: the loop master and its checks (notes/M12.md). Usage: tools/film/loop.sh <dir>
# Needs <dir>/p1.mkv (Part 1), <dir>/tail.mkv (composite.py), <dir>/tail.json.
set -eu
D=$1
XF=30   # the dissolve's frames (0.5 s): the file starts at Part 1's frame 30
# Key frames at seam A (the first composite frame) and where the dissolve begins, and a fixed
# quantiser of 10 over the dissolve: its last frame (the loop's) then matches the first (an I-frame)
# as closely as two static frames do.
P1N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/p1.mkv")
TN=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/tail.mkv")
CUT=$((P1N - XF))
DIS=$((CUT + TN - XF))
# The master: Part 1 from frame 30, then the tail (C2, the zoom, the dissolve into Part 1's first
# 30 frames): the last frame and the first are consecutive Part 1 frames.
ffmpeg -v error -y -i "$D/p1.mkv" -i "$D/tail.mkv" -filter_complex "
 [0:v]trim=start_frame=$XF,setpts=PTS-STARTPTS[a];
 [a][1:v]concat=n=2:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]" -map "[v]" \
 -c:v libx264 -profile:v high -level 4.2 -preset slow -crf 16 -maxrate 20M -bufsize 40M \
 -x264-params "zones=$DIS,$((DIS + XF - 1)),q=10" \
 -r 60 -g 120 -force_key_frames "expr:eq(n,$CUT)+eq(n,$DIS)" -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart -an "$D/loop-light-60.mp4"
# Three loops back to back, to watch both seams.
ffmpeg -v error -y -stream_loop 2 -i "$D/loop-light-60.mp4" -c copy "$D/loop3x.mp4"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,duration -of default=nw=1 "$D/loop-light-60.mp4"
ls -l "$D/loop-light-60.mp4" "$D/loop3x.mp4"
