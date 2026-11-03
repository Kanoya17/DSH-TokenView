# DSH-TokenView

DeepSeek Harness（DSH）插件：在**右上角**（窗口最小化按钮左侧）显示一个 Token 余额小胶囊，实时展示**剩余余额（美元）**，带连接状态圆点、可调自动刷新间隔，点击即可手动刷新。

> 由原桌面版 TokenView（Python + CustomTkinter）迁移而来，改为 DSH 的 Web 插件形态。

- 中文名：Token 余额查看
- English：Token Balance Viewer
- 插件包名：`@local/token-view`
- 版本：`1.0.0`

---

## 功能

- **右上角浮动小胶囊**：位置 `top: 6px; right: 150px`（最小化按钮左侧一点），不遮挡左侧会话列表。
- **只显示余额金额**：如 `$16.03`，不显示字段名；美元用 `$` 前缀。
- **连接状态圆点**（余额左侧）：
  - 🟢 绿色 `#30d158`：连接正常（取数成功）
  - 🔴 红色 `#ff453a`：断连（刷新失败 / 未配置接口地址与 Key）
  - ⚪ 灰色 `#98989d`：刷新中
- **点击刷新**：点击整颗胶囊触发一次取数；鼠标悬停显示「更新于 HH:MM:SS · 点击刷新」。
- **自动刷新**：按设置的间隔（默认 30 秒，范围 5–3600 秒）自动刷新。
- **配置项**：在「设置 → 通用设置」里配置**接口地址 / API Key / 刷新间隔**。
- **安全**：API Key 只保存在本机 Host 侧，不会返回给浏览器；刷新请求由 Host 发起，规避浏览器 CORS。
- **沿用旧版解析能力**：JSONPath 抽取（支持 `data.list[0].x`）+ `calc` 计算字段（如 `{data.total_available} / 500000`）。
- **中英文** display 元信息（`locale/zh.json`、`locale/en.json`）。

---

## 环境要求

- DeepSeek Harness（带 Web 界面）
- 无需额外运行时依赖：Host 使用 Node 内置 `fetch`；Client 零构建（`window.__ModuleLoader__.load`）

---

## 安装

### 方式一：从 GitHub 仓库安装

```bash
dsh plugin add Kanoya17/DSH-TokenView
```

或在 DSH Web 界面：**插件 → 添加插件**，填入仓库地址。

### 方式二：本地目录安装

```bash
dsh plugin add <仓库目录的绝对路径>
```

例如：

```bash
dsh plugin add D:\DSH\Workspace\Plugin\TokenView\plugin
```

安装后插件默认启用；若提示需要重启，重启 DSH 即可。

---

## 配置

打开 **设置 → 通用设置**（General），滚动到底部找到三行：

| 配置项 | 说明 |
|---|---|
| **接口地址** | 查余额/用量接口的完整 URL（GET） |
| **API Key** | Bearer 认证密钥，仅保存在本机 Host 侧 |
| **刷新间隔** | 自动刷新秒数，5–3600 |

修改后失焦或回车即保存，并**即时生效**（配置字段均为 schemastery `volatile`，无需重启）。

未配置前，右上角胶囊显示红点 +「未配置接口地址/Key」。

### 接口返回格式

接口需返回 JSON；字段按下表的 JSONPath 抽取。例如：

```json
{
  "data": {
    "name": "example",
    "total_granted": 114302665,
    "total_used": 105290665,
    "total_available": 8015000,
    "unlimited_quota": false,
    "expires_at": "2027-01-01T00:00:00Z"
  }
}
```

### 默认字段

| 名称 | JSON 路径 | 计算 |
|---|---|---|
| 账户名 | `data.name` | |
| 总授予 | `data.total_granted` | |
| 已用 | `data.total_used` | |
| 剩余可用 | `data.total_available` | |
| 是否无限额度 | `data.unlimited_quota` | |
| 过期时间 | `data.expires_at` | |
| 总金额(USD) | | `{data.total_granted} / 500000` |
| 余额(USD) | | `{data.total_available} / 500000` |

> 金额换算规则：`1 USD = 500000 quota`（按你所用厂商的实际规则调整 `calc` 即可）。
> `calc` 支持 `{JSON路径}` 引用 + 四则运算（`+ - * / **`）与 `round/int/float/abs/min/max`，其余标识符会被拒绝。

---

## 工作原理

- **Host 半（`index.js`）**
  - 导出 `Config`（schemastery）：`refreshInterval`、`apiUrl`、`apiKey`、`authHeader`、`authPrefix`、`fields`，全部 `volatile`。
  - 在 `webServer` 上注册 `/api/token-view` 前缀路由：
    - `GET  /api/token-view/config` → `{ refreshInterval, configured, fields }`（**不含 apiKey**）
    - `POST /api/token-view/refresh` → Host 用 Node `fetch` 请求外部接口（15s 超时），按字段解析/计算后返回 `{ ok, at, fields:[{name,value}] }`
  - 用 `connection.requestRejection(req)` 做浏览器信任门（401/403）。
  - 失败统一返回 `{ error: { code, message } }` 信封。
- **Client 半（`client.js`）**
  - 注册 `shell.overlay` 槽 → 右上角小胶囊（`pointer-events:auto` + `-webkit-app-region:no-drag`，保证可点击/悬停）。
  - 注册 `settings.general.item` 三行 → 接口地址 / API Key / 刷新间隔。
  - 通过同源 `fetch('/api/token-view/...')` 与 Host 通信（规避 CORS）。

---

## 自定义位置 / 尺寸

胶囊样式在 `client.js` 的 `CSS` 数组里，主要项：

```js
.token-view-card{
  position: fixed;
  top: 6px;
  right: 150px;      /* 右边距：越大越靠左 */
  height: 30px;
  max-width: 210px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  ...
}
```

- 想更靠左：把 `right` 调大（如 `right: 170px`）。
- 想改高度：改 `height`。
- 想换边框/圆角/阴影：直接改该规则即可。

---

## 目录结构

```
package.json       插件包清单（dsh.bundle 补丁 + dsh.client 客户端入口）
cordis.patch.yml   Loader 补丁：插入插件行
index.js           Host 半：Config + HTTP 路由 + 取数/解析
client.js          Client 半：浮动胶囊 + 设置行（零构建）
locale/zh.json     中文显示元信息（meta.title / meta.description）
locale/en.json     英文显示元信息
icon.svg           插件图标
```

---

## 常见问题

- **红点 +「未配置接口地址/Key」**：去「设置 → 通用设置」填写接口地址与 API Key。
- **点击没反应**：胶囊位于标题栏拖拽区，已用 `-webkit-app-region:no-drag` 处理；若仍无效，检查是否与最小化按钮重叠（把 `right` 调大）。
- **刷新失败**：查看胶囊提示；常见原因是接口地址/Key 错误、接口非 2xx、返回非 JSON、网络不通。
- **改了刷新间隔不生效**：确认在「设置 → 通用设置」保存成功（失焦/回车触发）。

---

## 许可证

未指定 license。如需开源分发，请补充 `LICENSE` 文件并在 `package.json` 中声明 `license`。
