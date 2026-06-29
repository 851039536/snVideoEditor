/**
 * 加密密钥配置
 *
 * 默认密钥用于视频加密/解密操作。
 * 第三方程序可通过"获取密钥"按钮复制此密钥后独立解密文件。
 *
 * ⚠️ 此密钥为硬编码默认值，如需更高安全性请替换为更复杂的密钥。
 */
export const DEFAULT_ENCRYPT_KEY = 'SN-Video-Editor-2026-Default-Key!'

/** 密钥掩码显示长度（前端展示时仅显示前 N 位） */
export const KEY_MASK_PREFIX_LENGTH = 6
