# Redis Key 设计与 TTL

## Key 列表
- `video:search:{query_hash}`：搜索结果缓存，TTL=300秒（5分钟）
- `video:check:{title_hash}`：去重检查缓存，TTL=600秒（10分钟）
- `video:stats`：统计缓存，TTL=3600秒（1小时）
- `video:pending_screenshot`：待截图视频队列（list）

## 推荐 redis.conf（本地台式机）
```conf
bind 127.0.0.1
port 6379
protected-mode yes
timeout 0
tcp-keepalive 300
databases 16
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfilename "appendonly.aof"
maxmemory 512mb
maxmemory-policy allkeys-lru
```

## 运维命令
```bash
# 查看队列长度
redis-cli LLEN video:pending_screenshot

# 查看统计缓存
redis-cli GET video:stats

# 清理所有 video 缓存（谨慎）
redis-cli KEYS "video:*" | xargs redis-cli DEL
```
