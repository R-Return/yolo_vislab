import re

with open('/Users/tongfanghui/Documents/GitHub/yolo_vislab/components/ImageViewer.tsx', 'r') as f:
    content = f.read()

# Fix 1: Separate the reset logic so selectedBoxIdx is retained when gtData updates
new_use_effect_1 = """  // Sync props to local state when item.gtData changes
  useEffect(() => {
    setLocalGtBoxes(item.gtData || []);
  }, [item.gtData]);

  // Only reset viewer state when navigating to a new item
  useEffect(() => {
    setSelectedBoxIdx(null);
    setPlayingBox(null);
    setHidePlayingBorder(false);
    setTempAudioBox(null);
  }, [item.name]);"""

content = re.sub(
    r"  // Sync props to local state when item changes.*?}, \[item, item\.gtData\]\); \/\/ Only reset when item specifically changes",
    new_use_effect_1,
    content,
    flags=re.DOTALL
)

# Fix 2: Increase hit radius for resize handles (from 15 to 30) for better UX
content = re.sub(
    r"if \(Math\.sqrt\(dx \* dx \+ dy \* dy\) < 15\) { \/\/ Slightly larger hit area",
    r"if (Math.sqrt(dx * dx + dy * dy) < 30) { // Larger hit area for easier resizing",
    content
)

# Fix 3: Increase hit radius for dragging a selected box (add a margin of 10 pixels roughly, but let's just use rawX/rawY or just add a padding to bx1,bx2 if hit === selectedBoxIdx)
# Wait, let's look at the body hit logic
# We can add a margin to the selected box's hit test so it's easier to grab, but wait, the coords.x/y are normalized (0-1).
# We can just leave the body hit as is, mostly the resize handle is the problem.
# Wait, if they have trouble dragging too, let's see.

with open('/Users/tongfanghui/Documents/GitHub/yolo_vislab/components/ImageViewer.tsx', 'w') as f:
    f.write(content)
