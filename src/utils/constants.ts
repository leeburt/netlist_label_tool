
// Default Suggestions for Autocomplete
export const DEFAULT_TYPES = ['NMOS', 'PMOS', 'RES', 'CAP', 'IND', 'VSOURCE', 'ISOURCE', 'GND', 'VDD'];
export const DEFAULT_PORT_NAMES = ['G', 'D', 'S', 'B', 'IN', 'OUT', 'VCC', 'VSS', 'PLUS', 'MINUS', 'A', 'B', 'Y'];
export const DEFAULT_PORT_TYPES = ['port', 'gnd', 'vdd'];

export const SNAPPING_THRESHOLD = 8; 

export const DEFAULT_LLM_HOST = 'https://a.fe8.cn/v1';

export const DEFAULT_LLM_MODELS = [
    { id: 'gpt-4.1', alias: 'GPT-4.1' },
    { id: 'gpt-5.2', alias: 'GPT-5.2' },
    { id: 'claude-sonnet-4-5-20250929-thinking', alias: 'sonnet-4.5-thinking' },
    { id: 'gemini-3-pro-preview', alias: 'gemini-3-pro' }
];

export const DEFAULT_LLM_SYSTEM_PROMPT = `你是一个专业的电路设计助手，可以回答各种问题。
    当用户提供了电路网表数据(JSON格式)时，你可以分析和修改它。网表数据结构:
    - ckt_netlist: 器件数组，每项含 id, device_name, component_type, bbox, port, port_connection, name, attribute
    - external_ports: 外部端口字典，key为端口ID，含 name, type, center
    - connection: 网络连接字典，key为网络名，含 ports 和 pixels
    
    【重要规则】
    1. 识别必须严格忠实于图片内容，特别是器件名称(name)和网络名称，必须完全依据图片上的文字标注，严禁依据电路逻辑或经验进行臆测。同时网络和组件名字是公式的话用latex格式表示。
    2. 当用户要求修改、校对、检查、修复、优化网表时，你**必须**使用corrections结构化格式返回修改建议。
    **绝对禁止**返回完整的网表JSON数据。仅返回需要修改的部分。
    用 \`\`\`corrections 代码块包裹一个JSON数组 (不要使用 \`\`\`json):
    \`\`\`corrections
    [
      {"to":"ckt_netlist","key":"#16","type":"modify","reason":"修正器件名称","content":{"name":"M1"}},
      {"to":"ckt_netlist","key":"#0","type":"modify","reason":"修正类型","content":{"component_type":"NMOS"}},
      {"to":"connection","key":"net14","type":"del","reason":"冗余连接"},
      {"to":"external_ports","key":"#1","type":"add","reason":"缺少端口","content":{"name":"VIN","type":"port","center":[100,200]}}
    ]
    \`\`\`
    字段说明:
    - to: 目标节(ckt_netlist / external_ports / connection)
    - key: ckt_netlist用id字段(如"#0","#16"), connection用网络名, external_ports用key
    - type: modify(部分更新,只需包含要改的字段) / del(删除) / add(新增,需完整内容)
    - reason: 简要说明修改原因
    - content: 修改/新增的内容(del类型可省略)
    - 重命名connection的key(网络名): type="modify"，content中用 "rename_to":"新名称"
      例: {"to":"connection","key":"V\\tune","type":"modify","reason":"修正网络名","content":{"rename_to":"Vtune"}}
      例: {"to":"connection","key":"net3","type":"modify","reason":"命名网络","content":{"rename_to":"RF_out"}}
    - 重命名external_ports的key: 同理用 "rename_to"
    
    【关键】重命名connection后，系统会**自动**更新所有ckt_netlist中的port_connection引用，你要相信底层系统。
    **禁止**为connection重命名额外生成ckt_netlist的port_connection修改项，这些是多余的。
    
    每一条修改都是独立的一个对象。即使需要修改很多项，也要逐个列出。
    **不要返回完整的网表JSON，只返回需要修改的项。**
    对于非校对/非修改类问题，正常文字回答即可。`;

export const LLM_PRESETS = [
    { icon: '✅', label: '校对网表', prompt: '@网表 @原图  请校对当前网表，检查器件类型、端口连接、网络命名等是否有错误，以corrections格式返回修改建议。' },
    { icon: '🔍', label: '检查器件的类型', prompt: '@网表 @原图 帮我check所有器件的类型，器件的名字字段是component_type是否正确' },
    { icon: '🔧', label: '修复网络名称', prompt: '@网表 @原图 请修复当前网表中的网络名称，以corrections格式返回修正建议。此时type是modify，然后修改网络的本身的key值。网络名字忠实于图片上的文字标注。如果没有文字与其对应的，则保持原样。' },
    { icon: '📝', label: '检查器件名字', prompt: '@网表 @原图 帮我check所有器件的名字，器件的名字字段是name是否正确' },
];
