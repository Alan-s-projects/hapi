# Docker seccomp profile for Codex bubblewrap

Based on Moby profiles default.json at commit
245180c51918481c0525424b3ee025d2b435d46c.
https://github.com/moby/profiles/blob/245180c51918481c0525424b3ee025d2b435d46c/seccomp/default.json

The only extra allow rule covers clone, unshare, mount, umount2, pivot_root.
These enable bubblewrap to create nested unprivileged user/mount namespaces.
All other Docker default rules remain intact, including clone3 returning ENOSYS.
The container remains non-root, cap_drop ALL, no-new-privileges, with no host
home directory, Docker socket, or devices exposed.

This does expand available kernel syscalls relative to Docker's default profile.
It is scoped to this one container and enables Codex's current inner sandbox;
do not replace it with seccomp=unconfined or privileged=true.
Recheck sandbox tests whenever updating Docker, Codex or this base profile.
