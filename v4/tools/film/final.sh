#!/bin/sh
# M12: the final video (notes/M12.md). Usage: tools/film/final.sh <dir>
# Part 1 from frame 30 (as the loop), the composite's C2 up to the loop's zoom (tail.json zoom_from:
# Part 2 through its settle), then the outro (outro.py: the bevel, the move into the Claude window's
# simulator panel, the window, the hold). Key frames at seam A and where the outro begins.
# loop-light-60.mp4 is not touched.
set -eu
D=$1
XF=30
P1N=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/p1.mkv")
Z0=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['zoom_from'])" "$D/tail.json")
CUT=$((P1N - XF))
OUT=$((CUT + Z0))
ffmpeg -v error -y -i "$D/p1.mkv" -i "$D/tail.mkv" -i "$D/outro.mkv" -filter_complex "
 [0:v]trim=start_frame=$XF,setpts=PTS-STARTPTS[a];
 [1:v]trim=end_frame=$Z0,setpts=PTS-STARTPTS[b];
 [a][b][2:v]concat=n=3:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]" -map "[v]" \
 -c:v libx264 -profile:v high -level 4.2 -preset slow -crf 16 -maxrate 20M -bufsize 40M \
 -r 60 -g 120 -force_key_frames "expr:eq(n,$CUT)+eq(n,$OUT)" -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart -an "$D/final-light-60.mp4"
echo "seam A at frame $CUT, the outro from frame $OUT"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,duration -of default=nw=1 "$D/final-light-60.mp4"
ls -l "$D/final-light-60.mp4"
