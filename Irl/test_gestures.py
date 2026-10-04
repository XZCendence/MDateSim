"""Synthetic-pose checks for the gesture detectors. Run: python test_gestures.py"""

import gestures as g
from fixtures import SW, J, bowing, check, heart, hold, kneeling, leaning_close, opened, pose, run, skeleton, squatting, standing

results = []
print("Kneel")
results.append(check("standing", run(g.Kneel(), hold(standing, 1.0)), False))
results.append(check("kneeling 1s", run(g.Kneel(), hold(kneeling, 1.0)), True))
results.append(check("kneeling 0.3s only", run(g.Kneel(), hold(kneeling, 0.3)), False))
results.append(check("squat is not kneel", run(g.Kneel(), hold(squatting, 1.0)), False))

print("Bow")
shallow = pose(skeleton(), tilt_deg=20)
results.append(check("upright", run(g.Bow(), hold(standing, 1.0)), False))
results.append(check("60° bow", run(g.Bow(), hold(bowing, 1.0)), True))
results.append(check("20° nod", run(g.Bow(), hold(shallow, 1.0)), False))

print("Jumping jacks")
arms_up = pose(skeleton({J.LEFT_WRIST: (600, 150), J.RIGHT_WRIST: (400, 150)}))  # feet together on purpose
def jack_cycles(n, period=0.6, start=0.0):
    frames, t = [], start
    for _ in range(n):
        frames += hold(arms_up, period / 2 - 0.05, t); t += period / 2
        frames += hold(standing, period / 2 - 0.05, t); t += period / 2
    return frames
jj = g.JumpingJacks(reps=3)
results.append(check("3 arm reps, feet ignored", run(jj, jack_cycles(3)), True) and jj.count == 3)
jj2 = g.JumpingJacks(reps=5)
results.append(check("3 of 5 not done", run(jj2, jack_cycles(3)), False) and jj2.count == 3)
slow = g.JumpingJacks(reps=1)
results.append(check("one 6s arm raise is too slow", run(slow, jack_cycles(1, period=6.0)), False))
results.append(check("arms held up is not a rep", run(g.JumpingJacks(reps=1), hold(arms_up, 3.0)), False))
one_arm = pose(skeleton({J.LEFT_WRIST: (600, 150)}))
results.append(check("one arm waving doesn't count", run(g.JumpingJacks(reps=1), hold(one_arm, 0.3) + hold(standing, 0.3, 0.3) + hold(one_arm, 0.3, 0.6) + hold(standing, 0.3, 0.9)), False))

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

print("Factory")
results.append(check("make() knows every name", all(isinstance(g.make(n), g.Gesture) for n in g.DETECTORS), True))

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
