# Waterfall performance repair, 2026-10-20

The late course first used scenery textures during flight. Shader compilation
does not upload those images to the GPU. Takeoff now waits for scenery, dragon
and sky readiness, uploads the scenery textures at their existing sizes, and
awaits shader preparation.

Other repairs:

- Reflection rendering restores the river's previous visibility mask instead
  of making every river section visible again. Renderer state is also restored
  when rendering throws.
- Stationary descendants have their transforms frozen too. Moving objects and
  their subtrees remain active.
- Target selection uses one scan instead of building and sorting a candidate
  array each physics step. Its results, tie order and hysteresis are unchanged.
- Flight reuses an existing scratch Euler object.

No source images, meshes, route, flight constants, reflection resolution,
control modes or quality settings were reduced or replaced.

## Measurements

Baseline: `58262788e701a17be72d9b9aac244b3d19d94d8a`.

Fresh, owned Chromium 151 browser processes used the same NVIDIA TITAN X
(Pascal), D3D11 and 844 by 390 viewport. Seven actual production-scene regions
were staged, camera and dragon transforms synchronized, and at least 80 frames
sampled per region. These are staged rendering checks, not a manually flown
course and not measurements from a physical phone.

| Late-course texture upload calls (`texSubImage2D`) | Before | After |
| --- | ---: | ---: |
| High quality, Sky Isles | 27 | 0 |
| High quality, lower canyon | 3 | 0 |
| Phone preset, Sky Isles | 22 | 0 |
| Phone preset, lower canyon | 4 | 0 |
| Phone preset, final region | 4 | 0 |

The work moves to the start screen; it does not disappear. A fresh visit may
spend longer preparing before takeoff.

High quality maintained a pixel ratio of 1 throughout both comparisons. Its
late-course 95th-percentile frame intervals remained roughly 47–48 ms in this
test setup. These results establish removal of late texture-upload work, not a
large sustained frame-rate gain. The phone preset's existing adaptive pixel
ratio changed at different times in the two runs, so those timing results
cannot support a speedup claim.

Both presets rendered all seven regions without recorded JavaScript errors.
The screenshots retain the dragon, scenery, river and waterfall.

## Regression evidence

`node --test tests/*.test.mjs`: 9 tests passed, 0 failed.

The four rendering regressions failed before repair. The preparation tests
cover waiting for resources and compilation, unique texture uploads and render
target restoration. Target selection matches the old implementation across
5,000 deterministic cases, including explicit ties and previous-target
preference; it no longer calls array sorting.

`node tests/course-check.mjs`: 16 simulated flights over 32 orbs and 19 hazards
at 6x, 8.6x, 12x and 15x; zero hazard hits or bumper steps.

A separate real browser-input check opens Settings, changes the slider, starts
flight, pauses, and reloads. It verifies 15x at 360 metres per simulation second
and 12x at 288, persistence of both values, and the separate ordinary-game speed
setting.
