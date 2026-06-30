# SN Video Editor 加密文件解密指南

> 本文档面向需要在第三方程序中解密 SN Video Editor 加密文件（`.enc`）的开发者。
>
> **当前格式版本：v2（0x02）**，PBKDF2 迭代 10,000 次。

---

## 一、加密格式总览

| 项 | 值 |
|----|-----|
| 加密算法 | AES-256-CTR（计数器模式） |
| 密钥派生 | PBKDF2-HMAC-SHA256，**1 万次迭代** |
| 派生密钥长度 | 32 字节（256 位） |
| IV 长度 | 16 字节（128 位），每次加密随机生成 |
| Salt 长度 | 16 字节（128 位），每次加密随机生成 |
| 格式版本 | `0x02`（v2） |
| 文件头长度 | 64 字节 |
| 密文起始偏移 | 第 65 字节起（跳过头部） |
| 加密文件扩展名 | `.enc` |

---

## 二、文件头结构（64 字节）

```
偏移量    长度    内容
──────    ────    ────────────
 0        16      IV（初始化向量）
16        16      Salt（PBKDF2 盐值）
32        1       格式版本号（0x02 = v2）
33        31      保留（全 0 填充）
```

> 解密时需从头部提取 IV（偏移 0~15）、Salt（偏移 16~31）和版本号（偏移 32）。偏移 33~63 的 31 字节保留区域忽略即可。版本号必须为 `0x02`，否则应拒绝解密。

---

## 三、密钥派生

```
PBKDF2(
  password   = "SN-Video-Editor-2026-Default-Key!",   // 默认密码
  salt       = <从文件头偏移 16 处读取的 16 字节>,
  iterations = 10000,                                   // v2: 1 万次迭代
  keyLen     = 32,                                      // 256 位
  digest     = SHA-256
)
```

输出 32 字节密钥用于 AES-256-CTR 解密。

### 默认密码

```
SN-Video-Editor-2026-Default-Key!
```

> ⚠️ 如果你自行修改了 `src/renderer/src/config/crypto.ts` 中的 `DEFAULT_ENCRYPT_KEY`，请使用你自定义的密钥。

---

## 四、解密流程（伪代码）

```
1. 打开 .enc 文件
2. 读取前 64 字节头部
3. 提取 IV = header[0:16]
4. 提取 Salt = header[16:32]
5. 检查版本号 header[32] == 0x02，不匹配则拒绝
6. 使用 PBKDF2(password, Salt, 10000, SHA-256) 派生 32 字节 Key
7. 创建 AES-256-CTR 解密器（Key, IV）
8. 从文件偏移 64 处开始读取密文
9. 通过解密器解密，写入输出文件
```

---

## 五、各语言解密示例

### Node.js

```js
const crypto = require('crypto')
const fs = require('fs')

const HEADER_LENGTH = 64
const DEFAULT_PASSWORD = 'SN-Video-Editor-2026-Default-Key!'

function decryptFile(inputPath, outputPath, password = DEFAULT_PASSWORD) {
  const stat = fs.statSync(inputPath)
  if (stat.size < HEADER_LENGTH) {
    throw new Error('文件太小，不含加密头')
  }

  // 读取头部 64 字节
  const fd = fs.openSync(inputPath, 'r')
  const header = Buffer.alloc(HEADER_LENGTH)
  fs.readSync(fd, header, 0, HEADER_LENGTH, 0)
  fs.closeSync(fd)

  // 提取 IV 和 Salt
  const iv = header.subarray(0, 16)
  const salt = header.subarray(16, 32)
  const version = header.readUInt8(32)

  if (version !== 0x02) {
    throw new Error(`不支持的格式版本: 0x${version.toString(16)}`)
  }

  // PBKDF2 派生密钥 (v2: 1 万次迭代)
  const key = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256')

  // 创建解密器
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv)

  // 流式解密（从偏移 64 开始读取密文）
  const input = fs.createReadStream(inputPath, { start: HEADER_LENGTH })
  const output = fs.createWriteStream(outputPath)
  input.pipe(decipher).pipe(output)

  return new Promise((resolve, reject) => {
    output.on('finish', resolve)
    output.on('error', reject)
    decipher.on('error', reject)
  })
}

// 使用示例
decryptFile('video.mp4.enc', 'video.mp4')
  .then(() => console.log('解密完成'))
  .catch(err => console.error('解密失败:', err))
```

### Python

```python
import os
import hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend

HEADER_LENGTH = 64
DEFAULT_PASSWORD = b"SN-Video-Editor-2026-Default-Key!"
CHUNK_SIZE = 64 * 1024  # 64KB


def decrypt_file(input_path: str, output_path: str, password: bytes = DEFAULT_PASSWORD):
    file_size = os.path.getsize(input_path)
    if file_size < HEADER_LENGTH:
        raise ValueError("文件太小，不含加密头")

    # 读取头部 64 字节
    with open(input_path, "rb") as f:
        header = f.read(HEADER_LENGTH)

    iv = header[0:16]
    salt = header[16:32]
    version = header[32]

    if version != 0x02:
        raise ValueError(f"不支持的格式版本: 0x{version:02x}")

    # PBKDF2 派生密钥 (v2: 1 万次迭代)
    kdf = PBKDF2HMAC(
        algorithm=hashlib.sha256(),
        length=32,
        salt=salt,
        iterations=10000,
        backend=default_backend(),
    )
    key = kdf.derive(password)

    # AES-256-CTR 解密
    cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
    decryptor = cipher.decryptor()

    with open(input_path, "rb") as fin, open(output_path, "wb") as fout:
        fin.seek(HEADER_LENGTH)  # 跳过头部
        while True:
            chunk = fin.read(CHUNK_SIZE)
            if not chunk:
                break
            fout.write(decryptor.update(chunk))
        fout.write(decryptor.finalize())

    print("解密完成")


# 使用示例
if __name__ == "__main__":
    decrypt_file("video.mp4.enc", "video.mp4")
```

> Python 依赖：`pip install cryptography`

### C# (.NET)

```csharp
using System.Security.Cryptography;

const int HeaderLength = 64;
const string DefaultPassword = "SN-Video-Editor-2026-Default-Key!";

static void DecryptFile(string inputPath, string outputPath)
{
    var fileInfo = new FileInfo(inputPath);
    if (fileInfo.Length < HeaderLength)
        throw new InvalidDataException("文件太小，不含加密头");

    // 读取头部
    byte[] header = new byte[HeaderLength];
    using (var fs = File.OpenRead(inputPath))
    {
        fs.Read(header, 0, HeaderLength);
    }

    // 提取 IV 和 Salt
    byte[] iv = header[0..16];
    byte[] salt = header[16..32];
    byte version = header[32];

    if (version != 0x02)
        throw new InvalidDataException($"不支持的格式版本: 0x{version:x2}");

    // PBKDF2 派生密钥 (v2: 1 万次迭代)
    using var pbkdf2 = new Rfc2898DeriveBytes(
        DefaultPassword,
        salt,
        10000,
        HashAlgorithmName.SHA256
    );
    byte[] key = pbkdf2.GetBytes(32);

    // AES-256-CTR 解密
    using var aes = Aes.Create();
    aes.Key = key;
    aes.Mode = CipherMode.ECB;  // CTR 模式需要手动实现 counter
    aes.Padding = PaddingMode.None;

    // 注意：.NET 的 Aes 类不直接支持 CTR 模式，需要手动实现。
    // 简化示例 — 实际建议使用 BouncyCastle 或手动 CTR 实现。
    // 参见下方"CTR 模式手动实现"。
}
```

### OpenSSL 命令行

AES-256-CTR 的密钥和 IV 需要从文件头手动提取后再传给 OpenSSL：

```bash
# 1. 提取 IV（前 16 字节）
dd if=input.enc bs=1 count=16 of=iv.bin

# 2. 提取 Salt（第 17~32 字节）
dd if=input.enc bs=1 skip=16 count=16 of=salt.bin

# 3. 用 PBKDF2 派生密钥（需要脚本协助，OpenSSL 不直接支持
#    从外部 salt 派生，建议使用 Python/Node.js）
#
# 4. 跳过头部解密（从第 65 字节开始）
dd if=input.enc bs=1 skip=64 of=ciphertext.bin

# 5. AES-256-CTR 解密
openssl enc -d -aes-256-ctr \
  -K <hex-key> \
  -iv $(xxd -p iv.bin) \
  -in ciphertext.bin \
  -out output.mp4
```

---

## 六、CTR 模式手动实现要点

如果你的语言/库不原生支持 AES-256-CTR，可手动实现 CTR 模式：

```
CTR 加解密逻辑（加密和解密完全相同）：

counter = IV (16 bytes, big-endian integer)
key = PBKDF2(password, salt, 100000, SHA-256) → 32 bytes

for each 16-byte block of plaintext:
    keystream = AES_ECB_encrypt(key, counter)   // 加密 counter 生成密钥流
    ciphertext = plaintext XOR keystream[0:block_length]
    counter = counter + 1                         // 计数器递增

注意：解密时做完全相同的操作（CTR 模式下加密和解密对称）。
```

---

## 七、文件命名约定

| 操作 | 输入 | 输出 |
|------|------|------|
| 加密 | `video.mp4` | `video.mp4.enc` |
| 解密 | `video.mp4.enc` | `video.mp4` |

加密后的文件在原文件名基础上追加 `.enc` 后缀，解密时去除 `.enc` 后缀还原。

---

## 八、注意事项

1. **密码正确性**：解密不会主动校验密码是否正确。如果密码错误，解密器会在中途抛出异常（因为 AES-CTR 密钥流不匹配导致解密结果无意义，但不会在开头就检测到）。
2. **Salt 唯一性**：每次加密都会生成新的随机 16 字节 Salt，因此同一文件用相同密码加密两次，密文完全不同。
3. **IV 唯一性**：每次加密生成新的随机 16 字节 IV，确保相同明文加密后密文不同。
4. **流式处理**：使用 64KB 块大小进行流式加解密，支持超大文件，无需将整个文件加载到内存。
