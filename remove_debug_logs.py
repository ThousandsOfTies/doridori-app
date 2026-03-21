import re

file_path = '/mnt/c/VibeCode/HomeTeacher/repos/home-teacher-core/src/components/study/PDFPane.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove all addDebugLog calls (entire lines)
content = re.sub(r'^\s*addDebugLog\([^)]+\)\s*\n', '', content, flags=re.MULTILINE)

# Remove debug log display section at the end
# Find and remove the debug log display div
debug_display_pattern = r'\s*\{/\* Debug Log Display \(iPad用\) \*/\}.*?\{debugLogs\.map\(\(log, i\) => \(.*?\n\s*\)\)\}\s*</div>\s*\)\}\s*\n'
content = re.sub(debug_display_pattern, '', content, flags=re.DOTALL)

# Also try a simpler pattern if the above doesn't work
if 'debugLogs.length' in content:
    # Find the entire debug logs display block
    lines = content.split('\n')
    new_lines = []
    skip_until_close = 0
    
    for i, line in enumerate(lines):
        if 'Debug Log Display' in line or 'debugLogs.length' in line:
            skip_until_close = 1
            continue
        
        if skip_until_close > 0:
            # Count braces to find the end of the block
            skip_until_close += line.count('{') - line.count('}')
            if skip_until_close <= 0:
                skip_until_close = 0
            continue
        
        new_lines.append(line)
    
    content = '\n'.join(new_lines)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Debug logs removed successfully")
