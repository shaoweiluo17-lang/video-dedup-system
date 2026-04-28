#!/usr/bin/env python3
"""
IDM 下载桥接工具
用法:
    python idm_bridge.py download --url "https://..." --path "D:/Downloads/Movies" --name "video.mp4"
    python idm_bridge.py status   # 检查 IDM 可用性
"""
import argparse
import os
import subprocess
import sys

# ---- 配置 ----
DEFAULT_IDM_EXE = r'C:\Program Files (x86)\Internet Download Manager\IDMan.exe'


def find_idm() -> str | None:
    """自动查找 IDM 安装路径"""
    candidates = [
        DEFAULT_IDM_EXE,
        r'C:\Program Files\Internet Download Manager\IDMan.exe',
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def download(url: str, save_dir: str, file_name: str | None = None) -> dict:
    """
    调用 IDM 命令行下载
    IDM 命令行语法:
      /d URL    - 下载链接
      /p PATH   - 保存目录
      /f NAME   - 保存文件名
      /q        - 静默模式
      /n        - 不显示下载对话框
    """
    idm_path = find_idm()
    if not idm_path:
        return {'success': False, 'error': 'IDM not found'}

    os.makedirs(save_dir, exist_ok=True)
    cmd = [idm_path, '/d', url, '/p', save_dir, '/n', '/q']
    if file_name:
        cmd += ['/f', file_name]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
            shell=True,  # IDM 在 Windows 上推荐 shell=True
        )
        return {
            'success': result.returncode == 0,
            'returncode': result.returncode,
            'stdout': result.stdout.strip(),
            'stderr': result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'IDM command timeout'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def check_available() -> dict:
    idm_path = find_idm()
    return {
        'available': idm_path is not None,
        'idm_path': idm_path,
    }


def main():
    parser = argparse.ArgumentParser(description='IDM Download Bridge')
    subparsers = parser.add_subparsers(dest='command')

    dl = subparsers.add_parser('download')
    dl.add_argument('--url', required=True)
    dl.add_argument('--path', required=True)
    dl.add_argument('--name', default=None)

    subparsers.add_parser('status')

    args = parser.parse_args()

    if args.command == 'download':
        result = download(args.url, args.path, args.name)
    elif args.command == 'status':
        result = check_available()
    else:
        parser.print_help()
        sys.exit(1)

    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
