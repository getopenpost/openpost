### Fixes

- Give the JavaScript engine a separate startup budget so cold compilation does not cause valid code to time out. User code keeps its two-second execution limit.
