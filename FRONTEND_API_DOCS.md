# 电路网表标注工具前端接口文档与核心逻辑解析

## 1. 概述

本文档基于 `src/` 目录下的前端代码（主要是 `App.tsx` 和 `store.ts`），系统梳理了电路网表标注工具的前后端交互接口、数据标准以及核心功能模块的内部逻辑。文档旨在为后续开发、维护及扩展提供参考，确保对数据流和状态流的准确理解。

## 2. 前后端交互接口 (API)

前端通过 RESTful API 与后端进行交互，主要用于任务数据的获取与保存。交互逻辑主要集中在 `src/App.tsx` 的 `useEffect` 初始化阶段及 `handleSaveToServer` 函数中。

### 2.1 上传任务 (Create Task)

*   **接口用途**: 创建新的标注任务，上传初始 JSON 数据和图片。
*   **触发场景**: 通常由外部系统调用（如 Gradio 或其他后台服务），用于初始化任务。
*   **请求方式**: `POST`
*   **请求 URL**: `/api/upload_task`
*   **Request Body**: `JSON` 对象
    ```json
    {
      "json_data": { ... },       // 任务初始数据 (Dict)
      "image_data": "base64...",  // 图片的 Base64 编码字符串
      "filename": "result.json"   // (可选) 保存的文件名，默认为 result.json
    }
    ```
*   **返回数据**:
    ```json
    {
      "task_id": "uuid-string",   // 生成的任务 ID
      "url": "/?id=uuid-string"   // 任务访问链接
    }
    ```
    *   *错误返回*: `{"error": "Image save failed: ..."}`

### 2.2 获取任务数据

*   **接口用途**: 加载指定任务的 `netlist.json` 标注数据。
*   **触发场景**: 页面加载时，若 URL 包含 `id` 参数（例如 `?id=123`），触发“API 模式”初始化流程。
*   **请求方式**: `GET`
*   **请求 URL**: `/api/get_task_json/${id}`
*   **参数**:
    *   `id` (Path Parameter): 任务 ID，从 URL 查询参数中获取。
*   **返回数据**: `JSON` 对象（即 `netlist.json` 的内容）。
    *   *前端处理*: 调用 `pythonDataToReactState` 对返回数据进行解析和兼容性处理（支持新旧两种格式）。

### 2.3 获取任务图片

*   **接口用途**: 加载指定任务的电路底图。
*   **触发场景**: 与获取任务数据并行触发。
*   **请求方式**: `GET`
*   **请求 URL**: `/api/get_task_image/${id}`
*   **参数**:
    *   `id` (Path Parameter): 任务 ID。
*   **返回数据**: `Blob` (Image)
    *   *前端处理*: 将 Blob 转换为 ObjectURL (`URL.createObjectURL`) 并设置为画布背景。

### 2.4 保存标注结果

*   **接口用途**: 将当前前端的标注状态保存回服务器。
*   **触发场景**: 用户点击工具栏的“保存”按钮（触发 `handleSaveToServer`）。
*   **请求方式**: `POST`
*   **请求 URL**: `/api/save_task/${taskId}`
*   **参数**:
    *   `taskId` (Path Parameter): 任务 ID。
*   **Request Body**: `JSON` 对象
    *   内容为前端发送的最新标注数据。
    *   *注意*: 后端目前直接保存接收到的 JSON 数据 (`new_data`) 到 `data.json`，不做格式转换 (Raw Save)。这意味着如果前端发送的是新格式数据，服务器也会按新格式保存。
*   **返回数据**:
    ```json
    {
      "success": boolean,
      "error": string // 仅在 success 为 false 时存在
    }
    ```
*   **前端交互**: 保存成功后会通过 `window.opener.postMessage('task_updated', '*')` 通知父窗口（如果有）。

---

## 3. 核心数据结构 (Netlist JSON 标准)

尽管前端兼容多种导入格式，但在**保存（导出）**时会统一转换为以下标准格式 (由 `reactStateToPythonData` 函数逻辑决定)。

### 3.1 Unified Netlist Format (统一网表格式)

```json
{
  "ckt_type": "ckt",
  "ckt_netlist": [ /* 组件列表 */ ],
  "external_ports": { /* 外部端口字典 */ },
  "connection": { /* 网络连接字典 */ },
  "llm_check": [], /* 保留字段 */
  // ... 其他透传的 extraData 字段
}
```

#### 3.1.1 组件对象 (Item in `ckt_netlist`)
```json
{
  "id": "string",             // 组件原始ID
  "device_name": "string",    // 组件名称 (如 R1, C1)
  "component_type": "string", // 组件类型 (如 Resistor, Capacitor)
  "bbox": {
    "top_left": [x, y],
    "bottom_right": [x, y]
  },
  "port": {                   // 组件内部端口
    "pin_name": {
      "type": "string",
      "center": [x, y],
      "top_left": [x, y],
      "bottom_right": [x, y]
    }
  },
  "port_connection": {        // 端口连接的网络
    "pin_name": "net_name"
  },
  "attribute": []
}
```

#### 3.1.2 外部端口对象 (Value in `external_ports`)
```json
{
  "name": "string",   // 端口名称
  "type": "string",   // 端口类型
  "center": [x, y],   // 坐标
  "top_left": [x, y],
  "bottom_right": [x, y]
}
```
*注：`external_ports` 的 Key 通常为外部端口的 ID（如 `#1`, `#2`）。*

#### 3.1.3 连接对象 (Value in `connection`)
```json
{
  "ports": [
    ["device_name", "pin_name"],     // 内部端口引用
    ["external", "external_port_id"] // 外部端口引用
  ],
  "pixels": [ // 连线的线段坐标（前端保存时目前为空，主要由后端算法生成或保留原数据）
    [[x1, y1], [x2, y2]], ...
  ]
}
```

---

## 4. 核心逻辑解读

### 4.1 模式区分：API 模式 vs 本地模式

代码通过检测 URL 参数 `id` 来决定工作模式：

*   **API 模式 (Task Mode)**:
    *   **触发**: URL 中存在 `id` 参数。
    *   **逻辑**: 自动调用 `/api/get_task_json` 和 `/api/get_task_image`。加载完成后，构造一个虚拟的 `File` 对象 (`dummyFile`) 并存入文件列表状态，模拟文件加载完成。
    *   **状态**: `taskId` 被设置，保存操作定向调用 `/api/save_task`。

*   **本地手动模式 (Local Mode)**:
    *   **触发**: URL 中无 `id` 参数。
    *   **逻辑**: 用户点击“Open Files”触发 `handleAddFilesWithPicker`，使用浏览器 File System Access API (`showOpenFilePicker`) 选择本地 `.json` 和图片文件。
    *   **状态**: `taskId` 为 null，不涉及网络请求，数据仅在本地处理。

### 4.2 数据加载逻辑 (`pythonDataToReactState`)

该函数负责将后端 JSON 转换为 React Flow 所需的 `nodes` 和 `edges` 状态。它具备高兼容性，处理两种输入格式：

1.  **新格式检测**: 优先检查是否存在 `components` 字段。
    *   解析 `components`: 转换为 `type: 'component'` 的节点，其端口转换为子节点 (`type: 'port'`, `parentId` 指向组件)。
    *   解析 `external_ports`: 转换为 `type: 'port'`, `isExternal: true` 的节点。
    *   解析 `connections`: 遍历连接关系，创建 `net_node` (网络中心点) 和 `net_edge` (连接线)，形成星型或总线型拓扑。

2.  **旧格式兼容 (Fallback)**: 若无 `components`，则按照 `ckt_netlist` 字段解析。
    *   逻辑与新格式类似，但字段映射不同（如 `bbox` 结构、`port` 定义方式）。
    *   **自动合并逻辑 (Auto-Merge)**: 在解析 `connection` 时，若发现两个物理位置接近的连接点属于不同的网络名称，代码会触发网络合并逻辑（记录在 `mergeReport` 中），将它们统一到一个网络名称下，并更新所有相关节点和边。

### 4.3 数据保存逻辑 (`reactStateToPythonData`)

该函数将前端的 React Flow 状态（Nodes/Edges）序列化回标准的 JSON 格式。

*   **统一输出**: 无论输入是新旧格式，输出始终标准化为 Unified Netlist Format（结构类似旧格式，但在字段命名上做了统一）。
*   **坐标计算**: 内部端口的坐标会从“相对父组件坐标”转换为“绝对坐标” (`getAbsPos`)。
*   **网络重建**:
    *   遍历所有带有 `netName` 数据的端口节点。
    *   将同一 `netName` 下的所有端口聚合到 `connection` 字典中。
    *   自动生成 `port_connection` 映射关系。
*   **数据清洗**: 移除前端专用的临时状态字段，保留导入时未识别的 `extraData`，确保数据无损回环。

### 4.4 网络与端口操作

*   **数据流**:
    *   **端口 (Port)**: 连接的端点。组件内部端口是组件节点的子节点，外部端口是独立节点。
    *   **网络 (Net)**: 在前端通过 `netName` 字符串标识。
    *   **连接 (Edge)**: React Flow 的 Edge 仅仅是可视化表现。实际的数据源是端口节点上的 `data.netName` 属性。
*   **交互逻辑**:
    *   当用户在画布上进行连线操作时，实际上是在修改相关端口节点的 `data.netName`。
    *   保存时，`reactStateToPythonData` 会扫描所有节点的 `netName`，重新聚合生成 `connection` 列表。这种设计使得前端对连线的增删改查非常灵活，不依赖具体的线段几何信息。
