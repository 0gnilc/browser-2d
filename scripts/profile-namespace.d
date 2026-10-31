#pragma D option quiet
#pragma D option strsize=1024
#pragma D option bufsize=16m
#pragma D option dynvarsize=16m
#pragma D option switchrate=10hz

BEGIN
{
  printf("READY\t%lld\n", walltimestamp);
}

syscall::mkdir:entry,
syscall::mkdir_extended:entry,
syscall::rmdir:entry
/strstr(copyinstr(arg0), "browser-2d-closed-recovery-") != NULL ||
 strstr(copyinstr(arg0), "b2d-family-") != NULL ||
 strstr(copyinstr(arg0), "b2d-spawn-") != NULL ||
 (strlen(copyinstr(arg0)) == 36 &&
  substr(copyinstr(arg0), 8, 1) == "-" &&
  substr(copyinstr(arg0), 13, 1) == "-" &&
  substr(copyinstr(arg0), 18, 1) == "-" &&
  substr(copyinstr(arg0), 23, 1) == "-")/
{
  self->profile_active = 1;
  this->profile_path = copyinstr(arg0);
  this->profile_dirfd = -2;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, this->profile_dirfd, this->profile_path);
}

syscall::mkdirat:entry
/strstr(copyinstr(arg1), "browser-2d-closed-recovery-") != NULL ||
 strstr(copyinstr(arg1), "b2d-family-") != NULL ||
 strstr(copyinstr(arg1), "b2d-spawn-") != NULL ||
 (strlen(copyinstr(arg1)) == 36 &&
  substr(copyinstr(arg1), 8, 1) == "-" &&
  substr(copyinstr(arg1), 13, 1) == "-" &&
  substr(copyinstr(arg1), 18, 1) == "-" &&
  substr(copyinstr(arg1), 23, 1) == "-")/
{
  self->profile_active = 1;
  this->profile_path = copyinstr(arg1);
  this->profile_dirfd = arg0;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, this->profile_dirfd, this->profile_path);
}

syscall::rename:entry
/strstr(copyinstr(arg1), "browser-2d-closed-recovery-") != NULL ||
 strstr(copyinstr(arg1), "b2d-family-") != NULL ||
 strstr(copyinstr(arg1), "b2d-spawn-") != NULL ||
 (strlen(copyinstr(arg1)) == 36 &&
  substr(copyinstr(arg1), 8, 1) == "-" &&
  substr(copyinstr(arg1), 13, 1) == "-" &&
  substr(copyinstr(arg1), 18, 1) == "-" &&
  substr(copyinstr(arg1), 23, 1) == "-")/
{
  self->profile_active = 1;
  this->profile_path = copyinstr(arg1);
  this->profile_dirfd = -2;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, this->profile_dirfd, this->profile_path);
}

syscall::renameat:entry,
syscall::renameatx_np:entry
/strstr(copyinstr(arg3), "browser-2d-closed-recovery-") != NULL ||
 strstr(copyinstr(arg3), "b2d-family-") != NULL ||
 strstr(copyinstr(arg3), "b2d-spawn-") != NULL ||
 (strlen(copyinstr(arg3)) == 36 &&
  substr(copyinstr(arg3), 8, 1) == "-" &&
  substr(copyinstr(arg3), 13, 1) == "-" &&
  substr(copyinstr(arg3), 18, 1) == "-" &&
  substr(copyinstr(arg3), 23, 1) == "-")/
{
  self->profile_active = 1;
  this->profile_path = copyinstr(arg3);
  this->profile_dirfd = arg2;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, this->profile_dirfd, this->profile_path);
}

syscall::mkdir:return,
syscall::mkdir_extended:return,
syscall::rmdir:return,
syscall::mkdirat:return,
syscall::rename:return,
syscall::renameat:return,
syscall::renameatx_np:return
/self->profile_active/
{
  printf("RETURN\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%d\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, arg0, errno);
  self->profile_active = 0;
}

syscall::open:entry,
syscall::open_nocancel:entry
/((arg1 & 3) != 0 || (arg1 & 0x200) != 0) &&
 (strstr(copyinstr(arg0), "browser-2d-closed-recovery-") != NULL ||
  strstr(copyinstr(arg0), "b2d-family-") != NULL ||
  strstr(copyinstr(arg0), "b2d-spawn-") != NULL)/
{
  self->profile_open = 1;
  printf("ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%s\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, arg1, copyinstr(arg0));
}

syscall::open:return,
syscall::open_nocancel:return
/self->profile_open/
{
  printf("RETURN\t%lld\t%s\t%d\t%d\t%d\t%d\t%s\t%d\t%d\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, probefunc, arg0, errno);
  self->profile_open = 0;
}

syscall::kill:entry
/(int)arg0 < -1 && arg1 == 0/
{
  self->profile_kill = 1;
  printf("GROUP_ENTRY\t%lld\t%s\t%d\t%d\t%d\t%d\t%d\t%d\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, (int)arg0, arg1);
}

syscall::kill:return
/self->profile_kill/
{
  printf("GROUP_RETURN\t%lld\t%s\t%d\t%d\t%d\t%d\t%d\t%d\n", walltimestamp, execname, pid, curpsinfo->pr_ppid, curpsinfo->pr_pgid, tid, arg0, errno);
  self->profile_kill = 0;
}

tick-600s
{
  printf("TIMEOUT\t%lld\n", walltimestamp);
  exit(0);
}
