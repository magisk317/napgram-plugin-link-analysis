#!/bin/bash
# ESM导入检查脚本 - 确保所有本地模块导入都有.js扩展名

set -e

echo "🔍 检查ESM导入规范..."

# 查找所有TypeScript文件中缺少.js后缀的本地导入
# 匹配模式: from './xxx' 或 from "./xxx" 但不以.js结尾
INVALID_IMPORTS=$(find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec grep -Hn "from ['\"]\\./[^'\"]*['\"]" {} \; | grep -v "\\.js['\"]" || true)

if [ -n "$INVALID_IMPORTS" ]; then
    echo "❌ 发现缺少.js扩展名的ESM导入："
    echo "$INVALID_IMPORTS"
    echo ""
    echo "请为本地模块导入添加.js扩展名，例如："
    echo "  ❌ import { foo } from './bar'"
    echo "  ✅ import { foo } from './bar.js'"
    echo ""
    echo "注意：即使源文件是.ts，导入时也应该写.js（因为编译后是.js）"
    exit 1
else
    echo "✅ 所有ESM导入都符合规范"
fi
