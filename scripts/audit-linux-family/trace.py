import json
import pathlib
import re
import subprocess
import sys

out = pathlib.Path('artifacts/linux-family')
out.mkdir(parents=True, exist_ok=True)
if sys.argv[1] == 'prepare':
    btf = subprocess.check_output(['sudo', 'bpftool', 'btf', 'dump', 'file', '/sys/kernel/btf/vmlinux', 'format', 'c'], text=True)
    enum = re.search(r'enum pid_type \{([^}]+)\}', btf).group(0)
    (out / 'pid-type.txt').write_text(enum)
    entries = re.findall(r'(PIDTYPE_\w+)\s*=\s*(\d+)', enum)
    pgid = dict(entries)['PIDTYPE_PGID']
    raw = subprocess.check_output(['sudo', 'bpftool', 'btf', 'dump', 'file', '/sys/kernel/btf/vmlinux', 'format', 'raw'], text=True)
    (out / 'vmlinux.h').write_text(btf)
    types = dict(re.findall(r"(?m)^\[(\d+)\] ([\s\S]*?)(?=^\[|\Z)", raw))
    def named_struct(name):
        return next(body for body in types.values() if body.startswith(f"STRUCT '{name}' "))
    def member_offset(body, name):
        members = re.findall(r"\t'([^']*)' type_id=(\d+) bits_offset=(\d+)", body)
        for member, type_id, offset in members:
            if member == name:
                return int(offset) // 8
        for member, type_id, offset in members:
            if not member and types[type_id].startswith(('STRUCT ', 'UNION ')):
                nested = member_offset(types[type_id], name)
                if nested is not None:
                    return int(offset) // 8 + nested
        return None
    pid_struct = named_struct('pid')
    upid_struct = named_struct('upid')
    numbers_offset = member_offset(pid_struct, 'numbers')
    nr_offset = member_offset(upid_struct, 'nr')
    assert numbers_offset is not None and nr_offset is not None, (pid_struct, upid_struct)
    (out / 'pid-struct-raw.txt').write_text(pid_struct + '\n' + upid_struct)
    group = f'*(int32 *)((uint64)curtask->signal->pids[{pgid}] + {numbers_offset + nr_offset})'
    blocks = ['BEGIN { printf("READY\\n"); }']
    calls = [('openat', 'filename', 'flags'), ('mkdir', 'pathname', 'mode'), ('mkdirat', 'pathname', 'mode'), ('rmdir', 'pathname', '0'), ('unlink', 'pathname', '0'), ('unlinkat', 'pathname', 'flag'), ('rename', 'newname', '0'), ('renameat', 'newname', '0'), ('renameat2', 'newname', 'flags'), ('symlink', 'newname', '0'), ('symlinkat', 'newname', '0')]
    for name, path, arg in calls:
        argument = '0' if arg == '0' else 'args->' + arg
        blocks.append(f'''tracepoint:syscalls:sys_enter_{name}
/strncmp(str(args->{path}), "/tmp/b2d-family-", 16) == 0 || strncmp(str(args->{path}), "/tmp/closed-recovery-", 21) == 0/
{{
 @start[tid] = nsecs;
 printf("NS_ENTRY\\t%llu\\t%d\\t%d\\t%d\\t%d\\t%s\\t{name}\\t%lld\\t%s\\n", @start[tid], pid, tid, curtask->real_parent->tgid, {group}, comm, {argument}, str(args->{path}, 128));
}}
tracepoint:syscalls:sys_exit_{name}
/@start[tid]/
{{
 printf("NS_RETURN\\t%llu\\t%llu\\t%d\\t%d\\t%lld\\n", @start[tid], nsecs, pid, tid, args->ret);
 delete(@start[tid]);
}}''')
    blocks.append(f'''tracepoint:syscalls:sys_enter_kill {{
 @killstart[tid] = nsecs; @target[tid] = (int64)(int32)args->pid; @signal[tid] = args->sig;
 @killgroup[tid] = {group};
}}
tracepoint:syscalls:sys_exit_kill /@killstart[tid]/ {{
 printf("GROUP\\t%llu\\t%llu\\t%d\\t%d\\t%d\\t%lld\\t%lld\\t%lld\\n", @killstart[tid], nsecs, pid, tid, @killgroup[tid], @target[tid], @signal[tid], args->ret);
 delete(@killstart[tid]); delete(@target[tid]); delete(@signal[tid]); delete(@killgroup[tid]);
}}''')
    (out / 'trace.bt').write_text('\n'.join(blocks))
    def git(*args):
        return subprocess.check_output(['git', *args], text=True).strip()
    expected = git('rev-parse', 'ee9a0e6:apps/worker/src')
    actual = git('rev-parse', 'HEAD:apps/worker/src')
    assert expected == actual, (expected, actual)
    metadata = {'source': git('rev-parse', 'HEAD'), 'productSource': git('rev-parse', 'ee9a0e6'), 'workerSourceTreeDigest': actual, 'workerSourceTreeDigestExpected': expected, 'lockDigest': subprocess.check_output(['sha256sum', 'pnpm-lock.yaml'], text=True).split()[0], 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'kernel': subprocess.check_output(['uname', '-a'], text=True).strip(), 'pgidEnum': enum, 'pgidBtfIndex': int(pgid), 'pidNumbersBtfByteOffset': numbers_offset, 'upidNrBtfByteOffset': nr_offset, 'sourceDirty': bool(git('status', '--porcelain')), 'traceCoverage': 'Completed syscalls with absolute controlled-prefix paths only, captured paths capped at 128 bytes. Relative paths and unlisted syscalls are outside coverage. Positive events do not prove exhaustive absence.'}
    (out / 'context.json').write_text(json.dumps(metadata, indent=2))
else:
    family = json.loads((out / 'chrome-family-linux-x64.json').read_text())
    context = json.loads((out / 'context.json').read_text())
    events = []
    groups = []
    pending = {}
    returns = []
    for line in (out / 'trace.tsv').read_text().splitlines():
        cols = line.split('\t')
        if cols[0] == 'NS_ENTRY':
            keys = ['kind', 'start', 'pid', 'tid', 'ppid', 'pgid', 'name', 'syscall', 'argument', 'path']
            event = dict(zip(keys, cols))
            for key in ['start', 'pid', 'tid', 'ppid', 'pgid', 'argument']:
                event[key] = int(event[key])
            pending[(event['tid'], event['start'])] = event
        elif cols[0] == 'NS_RETURN':
            returns.append(tuple(map(int, cols[1:])))
        elif cols[0] == 'GROUP':
            keys = ['kind', 'start', 'end', 'pid', 'tid', 'pgid', 'target', 'signal', 'result']
            event = dict(zip(keys, cols))
            for key in keys[1:]:
                event[key] = int(event[key])
            groups.append(event)
    for start, end, pid, tid, result in returns:
        event = pending.pop((tid, start))
        assert event['pid'] == pid
        event.update(end=end, result=result)
        events.append(event)
    profile = family['profile']
    main = family['mainPid']
    native = {entry['id'] for entry in family['nativeMembers']}
    writable = lambda e: e['syscall'] != 'openat' or e['argument'] & (1 | 2 | 64 | 512 | 1024)
    writes = [e for e in events if e['path'].startswith(profile + '/') and e['result'] >= 0 and writable(e)]
    native_writes = [e for e in writes if e['pid'] not in {family['workerPid'], family['helperPid']}]
    native_helpers = [e for e in native_writes if e['pid'] != main]
    controls = [e for e in writes if e['pid'] == family['helperPid'] and e['path'].endswith('/late-helper-write') and e['syscall'] == 'openat']
    escaped = [e for e in native_writes if e['pgid'] != main]
    esrch = [e for e in groups if e['target'] == -main and e['signal'] == 0 and e['result'] == -3 and e['pid'] == family['workerPid']]
    removals = [e for e in events if e['path'] == profile and e['syscall'] == 'rmdir' and e['result'] == 0]
    deletion_attempts = [e for e in events if (e['path'] == profile or e['path'].startswith(profile + '/')) and e['syscall'] in {'rmdir', 'unlink', 'unlinkat'} and e['pid'] == family['workerPid']]
    ordered = bool(esrch and removals and deletion_attempts and min(e['end'] for e in esrch) < min(e['start'] for e in deletion_attempts))
    report = {'family': family, 'context': context, 'nativeWriterCount': len(native_writes), 'nativeWriters': native_writes[:20], 'nativeHelperWriters': native_helpers[:20], 'nativeWriterGroups': sorted({e['pgid'] for e in native_writes}), 'escapedNativeWriters': escaped, 'helperPositiveWrites': controls, 'groupESRCH': esrch, 'profileRmdir': removals, 'firstProfileDeletionAttempt': min(deletion_attempts, key=lambda e: e['start']) if deletion_attempts else None, 'groupAbsentBeforeProfileRemoval': ordered, 'namespaceEventCount': len(events), 'groupEventCount': len(groups), 'unmatchedNamespaceEntries': list(pending.values()), 'traceStderr': (out / 'trace.stderr').read_text()}
    (out / 'analysis.json').write_text(json.dumps(report, indent=2))
    assert family['source'] == context['source']
    assert family['namespaceAbsentBeforeTeardown'] and family['preTeardownRootEntries'] == []
    assert family['mainGroup'] == family['helperGroup'] == main
    assert controls and all(e['pgid'] == main for e in controls), 'Positive helper PGID control missing or incorrect'
    assert native_writes, 'No actual Chrome profile writer traced'
    assert native_helpers, 'No actual Chrome helper profile writer traced'
    assert not escaped, 'BLOCKING: actual Chrome profile writer escaped minted group'
    assert ordered, 'Missing signal-zero ESRCH before successful profile rmdir'
    assert all(e['signal'] == 0 for e in groups if e['pid'] == family['workerPid'] and e['target'] < 0), 'Unexpected group termination authority'
    print(json.dumps({'source': context['source'], 'nativeWriterCount': len(native_writes), 'nativeHelperWriterCount': len(native_helpers), 'writerGroups': report['nativeWriterGroups'], 'main': main, 'helperPositiveControl': len(controls), 'groupAbsentBeforeProfileRemoval': ordered, 'namespaceAbsentBeforeTeardown': True}, indent=2))
