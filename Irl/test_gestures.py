"""Synthetic-pose checks for the gesture detectors. Run: python test_gestures.py"""

import gestures as g
from fixtures import SW, J, bowing, check, heart, hold, kneeling, leaning_close, opened, pose, run, skeleton, squatting, standing

results = []
print("Kneel")
results.append(check("standing", run(g.Kneel(), hold(standing, 1.0)), False))
results.append(check("kneeling 1s", run(g.Kneel(), hold(kneeling, 1.0)), True))
results.append(check("kneeling 0.3s only", run(g.Kneel(), hold(kneeling, 0.3)), False))
results.append(check("squat is not kneel", run(g.Kneel(), hold(squatting, 1.0)), False))
upright_kneel = pose(skeleton({J.LEFT_KNEE: (535, 620), J.RIGHT_KNEE: (465, 620),
                               J.LEFT_ANKLE: (535, 632), J.RIGHT_ANKLE: (465, 632)}))
results.append(check("upright kneel (thighs vertical)", run(g.Kneel(), hold(upright_kneel, 1.0)), True))
feet_cropped = pose(skeleton(), hide=(J.LEFT_ANKLE, J.RIGHT_ANKLE))
results.append(check("standing with feet out of frame", run(g.Kneel(), hold(feet_cropped, 1.0)), False))
occluded = pose(skeleton({J.LEFT_KNEE: (535, 620), J.RIGHT_KNEE: (465, 620), J.LEFT_ANKLE: (535, 640), J.RIGHT_ANKLE: (465, 640)}),
                hide=(J.LEFT_ANKLE, J.RIGHT_ANKLE))
results.append(check("upright kneel, ankles hidden behind thighs", run(g.Kneel(), hold(occluded, 1.0)), True))
hinted = g.Kneel(); hinted.hint = {"kneel": 0.9}
results.append(check("learned model says kneel", run(hinted, hold(feet_cropped, 1.0)), True))

print("Bow")
shallow = pose(skeleton(), tilt_deg=20)
results.append(check("upright", run(g.Bow(), hold(standing, 1.0)), False))
results.append(check("60° bow", run(g.Bow(), hold(bowing, 1.0)), True))
results.append(check("20° nod", run(g.Bow(), hold(shallow, 1.0)), False))

print("Jumping jacks")
# straight arms overhead: elbows on the shoulder->wrist line
arms_up = pose(skeleton({J.LEFT_ELBOW: (565, 215), J.RIGHT_ELBOW: (435, 215),
                         J.LEFT_WRIST: (580, 130), J.RIGHT_WRIST: (420, 130)}))
# bent arms "overhead": wrists high but elbows tucked (flailing)
bent_up = pose(skeleton({J.LEFT_ELBOW: (600, 330), J.RIGHT_ELBOW: (400, 330),
                         J.LEFT_WRIST: (560, 180), J.RIGHT_WRIST: (440, 180)}))
def arm_cycles(up, n, period=0.6, start=0.0):
    frames, t = [], start
    for _ in range(n):
        frames += hold(up, period / 2 - 0.05, t); t += period / 2
        frames += hold(standing, period / 2 - 0.05, t); t += period / 2
    return frames
jj = g.JumpingJacks(reps=3)
results.append(check("3 straight-arm reps", run(jj, arm_cycles(arms_up, 3)), True) and jj.count == 3)
jj2 = g.JumpingJacks(reps=5)
results.append(check("3 of 5 not done", run(jj2, arm_cycles(arms_up, 3)), False) and jj2.count == 3)
bent = g.JumpingJacks(reps=1)
results.append(check("bent-arm flailing is not a rep", run(bent, arm_cycles(bent_up, 3)), False) and bent.count == 0)
results.append(check("one 6s raise is too slow", run(g.JumpingJacks(reps=1), arm_cycles(arms_up, 1, period=6.0)), False))
results.append(check("arms held up is not a rep", run(g.JumpingJacks(reps=1), hold(arms_up, 3.0)), False))

print("Dance")
import math
def dancing_frames(seconds=4.0, fps=30, amp=1.2, hz=2.0, arms=True):
    out = []
    for i in range(int(seconds * fps)):
        tt = i / fps
        sway = amp * SW * math.sin(2 * math.pi * hz * tt)
        o = {J.LEFT_HIP: (535 + sway * 0.3, 480), J.RIGHT_HIP: (465 + sway * 0.3, 480)}
        if arms:
            o[J.LEFT_WRIST] = (580 + sway, 460 - abs(sway))
            o[J.RIGHT_WRIST] = (420 - sway, 460 - abs(sway))
            o[J.LEFT_ELBOW] = (570 + sway * 0.6, 380)
            o[J.RIGHT_ELBOW] = (430 - sway * 0.6, 380)
        out.append((tt, pose(skeleton(o))))
    return out
results.append(check("dancing 4s", run(g.Dance(), dancing_frames()), True))
results.append(check("dancing 1.5s only", run(g.Dance(), dancing_frames(seconds=1.5)), False))
results.append(check("standing still", run(g.Dance(), hold(standing, 4.0)), False))
results.append(check("hips only, arms still", run(g.Dance(), dancing_frames(arms=False)), False))
walk = [(i / 30, pose({j: (x + i * 4, y) for j, (x, y) in skeleton().items()})) for i in range(120)]
results.append(check("walking across frame", run(g.Dance(), walk), False))
results.append(check("straight-arm jack cycles are not dancing", run(g.Dance(), arm_cycles(arms_up, 8)), False))

print("Heart hands")
arms_up_apart = pose(skeleton({J.LEFT_WRIST: (600, 120), J.RIGHT_WRIST: (400, 120),
                                 J.LEFT_ELBOW: (580, 220), J.RIGHT_ELBOW: (420, 220)}))
results.append(check("heart", run(g.HeartHands(), hold(heart, 1.0)), True))
results.append(check("arms up apart", run(g.HeartHands(), hold(arms_up_apart, 1.0)), False))

print("Blow kiss")
at_mouth = pose(skeleton({J.LEFT_WRIST: (505, 258)}), depth={J.LEFT_WRIST: 1.9})
thrown = pose(skeleton({J.LEFT_WRIST: (560, 300)}), depth={J.LEFT_WRIST: 1.6})
flow = hold(at_mouth, 0.3, 0) + hold(thrown, 0.2, 0.4)
results.append(check("hand to mouth then thrown", run(g.BlowKiss(), flow), True))
results.append(check("hand at mouth only", run(g.BlowKiss(), hold(at_mouth, 1.0)), False))
results.append(check("thrown without arming", run(g.BlowKiss(), hold(thrown, 1.0)), False))
late = hold(at_mouth, 0.3, 0) + hold(standing, 1.5, 0.4) + hold(thrown, 0.2, 2.0)
results.append(check("released too late", run(g.BlowKiss(), late), False))

print("Kiss")
no_depth_close = pose(skeleton({J.LEFT_EAR: (580, 225), J.RIGHT_EAR: (420, 225)}),
                      depth={J.NOSE: None, J.LEFT_SHOULDER: 0.5, J.RIGHT_SHOULDER: 0.5})
results.append(check("close, depth dropped out", run(g.Kiss(), hold(no_depth_close, 1.0)), True))
upright_far = pose(skeleton(), depth={J.NOSE: 2.0})
results.append(check("upright far", run(g.Kiss(), hold(upright_far, 1.0)), False))
close_upright = pose(skeleton(), depth={J.NOSE: 0.5, J.LEFT_SHOULDER: 0.55, J.RIGHT_SHOULDER: 0.55})
results.append(check("close but upright", run(g.Kiss(), hold(close_upright, 1.0)), False))
arms_length = pose(skeleton({J.LEFT_EAR: (560, 225), J.RIGHT_EAR: (440, 225)}),
                   depth={J.NOSE: 0.45, J.LEFT_SHOULDER: 0.75, J.RIGHT_SHOULDER: 0.75})
results.append(check("leaning at arm's length is not a kiss", run(g.Kiss(), hold(arms_length, 1.0)), False))

print("Look / Beg")
turned_away = pose(skeleton({J.LEFT_SHOULDER: (450, 300), J.RIGHT_SHOULDER: (550, 300)}))
head_turned = pose(skeleton({J.NOSE: (530, 230)}))
results.append(check("facing camera", run(g.Look(), hold(standing, 1.5)), True))
results.append(check("back turned", run(g.Look(), hold(turned_away, 1.5)), False))
results.append(check("head turned aside", run(g.Look(), hold(head_turned, 1.5)), False))
results.append(check("glance under 1s", run(g.Look(), hold(standing, 0.5)), False))
kneel_pts = {J.LEFT_HIP: (535, 560), J.RIGHT_HIP: (465, 560), J.LEFT_KNEE: (535, 640), J.RIGHT_KNEE: (465, 640),
             J.LEFT_ANKLE: (535, 650), J.RIGHT_ANKLE: (465, 650)}
begging = pose(skeleton({**kneel_pts, J.LEFT_WRIST: (512, 400), J.RIGHT_WRIST: (488, 400),
                         J.LEFT_ELBOW: (560, 430), J.RIGHT_ELBOW: (440, 430)}))
standing_clasped = pose(skeleton({J.LEFT_WRIST: (512, 380), J.RIGHT_WRIST: (488, 380)}))
results.append(check("kneeling, hands clasped", run(g.Beg(), hold(begging, 1.5)), True))
results.append(check("kneeling, hands at sides", run(g.Beg(), hold(kneeling, 1.5)), False))
results.append(check("standing, hands clasped", run(g.Beg(), hold(standing_clasped, 1.5)), False))
# the real failure: ankles hidden, hands clasped a bit apart, and the learned model no longer says "kneel"
beg_real = pose(skeleton({J.LEFT_HIP: (535, 480), J.RIGHT_HIP: (465, 480), J.LEFT_KNEE: (535, 620), J.RIGHT_KNEE: (465, 620),
                          J.LEFT_ANKLE: (535, 640), J.RIGHT_ANKLE: (465, 640),
                          J.LEFT_WRIST: (530, 400), J.RIGHT_WRIST: (470, 400), J.LEFT_ELBOW: (575, 420), J.RIGHT_ELBOW: (425, 420)}),
                hide=(J.LEFT_ANKLE, J.RIGHT_ANKLE))
b = g.Beg(); b.hint = {"kneel": 0.1, "idle": 0.6}
results.append(check("beg: ankles hidden, loose clasp, model unsure", run(b, hold(beg_real, 1.5)), True))
b2 = g.Beg()
results.append(check("kneel then clasp while rising slightly", run(b2, hold(kneeling, 1.0) + hold(standing_clasped, 1.0, 1.0)), True))

print("Factory")
results.append(check("make() knows every name", all(isinstance(g.make(n), g.Gesture) for n in g.DATE_DETECTORS), True))

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
