import re

file_path = '/mnt/c/VibeCode/HomeTeacher/repos/home-teacher-core/src/components/study/PDFPane.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. マウントログの追加 (addDebugLog定義の後)
mount_log = """
    // マウント確認用
    useEffect(() => {
        addDebugLog('🚀 PDFPane Mounted')
        return () => addDebugLog('💀 PDFPane Unmounted')
    }, [])
"""
if '🚀 PDFPane Mounted' not in content:
    content = re.sub(r'(const addDebugLog = \(msg: string\) => \{[^}]+\n\s+console\.log\(msg\)\n\s+\})', r'\1' + mount_log, content)

# 2. Ref値確認ログの追加
# Gap計算直後
if '🔍 Check: Ref=' not in content:
    content = content.replace(
        'addDebugLog(`✅ Valid tap, gap=${timeSinceLastTap}ms`)',
        'addDebugLog(`✅ Valid tap, gap=${timeSinceLastTap}ms`)\n                            addDebugLog(`🔍 Check: Ref=${lastTwoFingerTapTime.current}, Now=${now}`)'
    )

# Undo時のリセット前
if '🔄 Undo Reset' not in content:
    content = content.replace(
        'addDebugLog(\'🎉 DOUBLE TAP SUCCESS!\')',
        'addDebugLog(\'🎉 DOUBLE TAP SUCCESS!\')\n                                addDebugLog(`🔄 Undo Reset. Was: ${lastTwoFingerTapTime.current}`)'
    )

# 1回目記録時のセット前
if '💾 Set Ref' not in content:
    content = content.replace(
        'addDebugLog(\'📝 First tap recorded\')',
        'addDebugLog(\'📝 First tap recorded\')\n                                addDebugLog(`💾 Set Ref. Was: ${lastTwoFingerTapTime.current} -> New: ${now}`)'
    )

# タイムアウト時のリセット時
if '🗑️ Timeout Reset' not in content:
    content = content.replace(
        'addDebugLog(\'⏱️ Timeout - reset\')',
        'addDebugLog(\'⏱️ Timeout - reset\')\n                                    addDebugLog(`🗑️ Timeout Reset. Was: ${lastTwoFingerTapTime.current}`)'
    )

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Detailed debug logs added successfully")
