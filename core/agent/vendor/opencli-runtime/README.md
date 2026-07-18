# OpenCLI runtime

Personal Agent release builds install the exact production dependency graph in
this directory into the immutable Node payload. `npm ci` runs with lifecycle
scripts disabled; customers never need Node.js, npm, or a global `opencli`
command.

The browser extension remains an explicit user-granted browser permission and
is not bundled or silently enabled. Runtime updates ship only with a new
Personal Agent release.
