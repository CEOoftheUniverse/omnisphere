import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, { 
    ReactFlowProvider,
    MiniMap, 
    Controls, 
    Background, 
    useNodesState, 
    useEdgesState, 
    addEdge, 
    Handle, 
    Position 
} from 'react-flow-renderer';
import './styles.css';

// ----------------------------------------------------
// Custom Node Factory
// ----------------------------------------------------
const createLLMNode = (title, colorClass) => {
    return ({ id, data }) => {
        const [weight, setWeight] = React.useState(data.weight !== undefined ? data.weight : 50);
        const [complexity, setComplexity] = React.useState(data.complexity !== undefined ? data.complexity : 50);

        const handleWeightChange = (e) => {
            const val = e.target.value;
            setWeight(val);
            if(data.onFieldChange) data.onFieldChange(id, 'weight', parseInt(val));
        };

        const handleComplexityChange = (e) => {
            const val = e.target.value;
            setComplexity(val);
            if(data.onFieldChange) data.onFieldChange(id, 'complexity', parseInt(val));
        };

        const handleModeChange = (e) => {
            if(data.onFieldChange) data.onFieldChange(id, 'mode', e.target.value);
        };

        return (
            <div className={`react-flow__node ${colorClass}`}>
                <Handle type="target" position={Position.Top} />
                <div className="node-header">
                    <span>{title}</span>
                    <span className="node-cost">{data.costLabel || 'Var/1k'}</span>
                </div>
                {data.description && <div style={{fontSize: '10px', color: '#A0A0B0', marginBottom: '10px'}}>{data.description}</div>}
                
                <div style={{marginBottom: '12px'}}>
                    <label style={{fontSize: '10px', color: '#A0A0B0', display: 'block', marginBottom: '4px'}}>Reasoning Mode:</label>
                    <select 
                        defaultValue={data.mode || "pro"} 
                        onChange={handleModeChange}
                        className="nodrag"
                    >
                        <option value="simple">Simple Synthesis</option>
                        <option value="pro">Pro Mode</option>
                        <option value="heavy">Heavy Thinking</option>
                        <option value="deep_research">Deep Web Research</option>
                    </select>
                </div>

                <div style={{marginBottom: '12px'}}>
                    <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#A0A0B0', marginBottom: '4px'}}>
                        System Weight: <span style={{color: 'white', fontWeight: 'bold'}}>{weight}%</span>
                    </label>
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={weight}
                        onChange={handleWeightChange}
                        className="nodrag custom-slider"
                    />
                </div>

                <div>
                    <label style={{display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#A0A0B0', marginBottom: '4px'}}>
                        Cost / Inference Depth: <span style={{color: 'white', fontWeight: 'bold'}}>{complexity}%</span>
                    </label>
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={complexity}
                        onChange={handleComplexityChange}
                        className="nodrag custom-slider complexity-slider"
                    />
                </div>
                <Handle type="source" position={Position.Bottom} />
            </div>
        );
    };
};

const nodeTypes = {
    openai: createLLMNode('GPT-5.4', 'node-openai'),
    anthropic: createLLMNode('Claude 4.6', 'node-anthropic'),
    google: createLLMNode('Gemini 1.5 Pro', 'node-google'),
    moonshot: createLLMNode('Kimi Claw (Web)', 'node-moonshot'),
    xai: createLLMNode('Grok 2.0', 'node-xai'),
    deepseek: createLLMNode('DeepSeek V3', 'node-deepseek'),
    qwen: createLLMNode('Qwen 2.5 Max', 'node-qwen'),
};

// ----------------------------------------------------
// Sidebar Component for Drag and Drop
// ----------------------------------------------------
const Sidebar = () => {
  const onDragStart = (event, nodeType, nodeData) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/data', JSON.stringify(nodeData));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="toolbox-sidebar">
      <h3 style={{marginTop: 0, color: '#00ffff'}}>Pipeline Arsenal</h3>
      <p style={{fontSize: '11px', color: '#A0A0B0'}}>Drag elements into the workspace to architect custom AI pipelines.</p>
      
      <div className="dndnode node-anthropic" onDragStart={(e) => onDragStart(e, 'anthropic', { costLabel: '$0.015/1k', description: 'Strong coding/reasoning.' })} draggable>
        Claude 4.6 Node
      </div>
      <div className="dndnode node-openai" onDragStart={(e) => onDragStart(e, 'openai', { costLabel: '$0.020/1k', description: 'General intelligence.' })} draggable>
        GPT-5.4 Node
      </div>
      <div className="dndnode node-google" onDragStart={(e) => onDragStart(e, 'google', { costLabel: '$0.005/1k', description: 'Multimodal / Large context.' })} draggable>
        Gemini 1.5 Node
      </div>
      <div className="dndnode node-moonshot" onDragStart={(e) => onDragStart(e, 'moonshot', { costLabel: '$0.00/1k', description: 'Scrapes Kimi natively.' })} draggable>
        Kimi Claw Node
      </div>
      <div className="dndnode node-qwen" onDragStart={(e) => onDragStart(e, 'qwen', { costLabel: '$0.008/1k', description: 'Efficient scalable logic.' })} draggable>
        Qwen 2.5 Node
      </div>
      <div className="dndnode node-deepseek" onDragStart={(e) => onDragStart(e, 'deepseek', { costLabel: '$0.003/1k', description: 'High-speed coding.' })} draggable>
        DeepSeek Node
      </div>

    </aside>
  );
};


// ----------------------------------------------------
// Main Application
// ----------------------------------------------------
const initialNodes = [
  { id: 'start', type: 'input', data: { label: 'Input Prompt / Goal' }, position: { x: 450, y: 30 } },
  { id: 'node_anthropic', type: 'anthropic', data: { label: 'Claude', weight: 80, complexity: 50 }, position: { x: 450, y: 250 } },
  { id: 'end_consensus', type: 'output', data: { label: 'Synthesized Consensus Output' }, position: { x: 450, y: 500 } },
];
const initialEdges = [
  { id: 'e-start-anthropic', source: 'start', target: 'node_anthropic' },
  { id: 'e-anthropic-end', source: 'node_anthropic', target: 'end_consensus' }
];

let id = 0;
const getId = () => `dndnode_${id++}`;

export default function App() {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  const [prompt, setPrompt] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const fetchHistory = async () => {
      try {
          const res = await fetch('/api/history');
          const data = await res.json();
          setHistory(data);
      } catch(e) { console.error('History fetch error', e); }
  };

  React.useEffect(() => {
      fetchHistory();
  }, []);

  const onFieldChange = useCallback((nodeId, key, value) => {
      setNodes((nds) => 
          nds.map((n) => {
              if (n.id === nodeId) {
                  return { ...n, data: { ...n.data, [key]: value }};
              }
              return n;
          })
      );
  }, [setNodes]);

  React.useEffect(() => {
      setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, onFieldChange } })));
  }, [onFieldChange, setNodes]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow/type');
      let nodeDataStr = event.dataTransfer.getData('application/reactflow/data');
      let parsedData = {};
      try { parsedData = JSON.parse(nodeDataStr); } catch(e){}

      // check if the dropped element is valid
      if (typeof type === 'undefined' || !type) { return; }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });
      
        const newNode = {
        id: getId(),
        type,
        position,
        data: { ...parsedData, weight: 50, complexity: 50, mode: 'pro', onFieldChange },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes, onFieldChange]
  );

  const runPipeline = async () => {
    if (!prompt) return alert('Enter a master prompt to deploy to the pipeline.');
    setLoading(true);
    setResults(null);
    try {
        const activeNodeIds = edges.filter(e => e.source === 'start').map(e => e.target);
        const activeNodes = nodes.filter(n => activeNodeIds.includes(n.id));
        const activeModels = activeNodes.map(n => ({
            name: n.type,
            weight: n.data.weight !== undefined ? n.data.weight : 50,
            complexity: n.data.complexity !== undefined ? n.data.complexity : 50,
            mode: n.data.mode || 'pro'
        }));
        
        if (activeModels.length === 0) {
            alert('Warning: No models connected to the Start node. The Synthesizer has nothing to process.');
            setLoading(false);
            return;
        }

        const response = await fetch('/api/consensus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, models: activeModels })
        });
        const data = await response.json();
        setResults(data);
        fetchHistory(); 
    } catch(err) {
        alert('Error: ' + err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#050505', color: 'white' }}>
        <header style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(0, 255, 255, 0.1)' }}>
            <div style={{display: 'flex', alignItems: 'center'}}>
                <h1 style={{margin: '0 20px 0 0', fontFamily: 'Orbitron', color: '#00ffff', textShadow: '0 0 10px rgba(0,255,255,0.4)'}}>OMNISPHERE</h1>
                <span style={{fontSize: '12px', color: '#A0A0B0', letterSpacing: '2px', textTransform:'uppercase'}}>Visual Swarm Orchestrator</span>
            </div>
            
            <div style={{ display: 'flex', width: '60%', gap: '10px'}}>
                <button 
                    onClick={() => { setHistoryOpen(!historyOpen); if(!historyOpen) fetchHistory(); }} 
                    style={{background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '10px 15px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'Outfit'}}
                >
                    History
                </button>
                <div style={{ display: 'flex', flex: 1}}>
                    <input 
                        value={prompt} 
                        onChange={e => setPrompt(e.target.value)} 
                        placeholder='Enter core task (e.g. Architect a scalable microservice)...' 
                        style={{ flex: 1, padding: '12px 15px', background: 'rgba(0,0,0,0.6)', color: 'white', border: '1px solid #00ffff', borderRadius: '6px 0 0 6px', fontFamily: 'Outfit'}}
                    />
                    <button className="btn-primary" onClick={runPipeline} style={{borderRadius: '0 6px 6px 0', border: '1px solid #00ffff'}}>
                        Execute Pipeline
                    </button>
                </div>
            </div>
        </header>

        <div id="history-panel" className={historyOpen ? 'open' : ''}>
            <h3 style={{margin: '0 0 15px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px', fontSize: '14px', letterSpacing: '1px'}}>SWARM ARCHIVES</h3>
            {history.map(item => (
                <div key={item.id} className="history-item" onClick={() => {
                    setResults({ rawResponses: typeof item.raw_responses === 'string' ? JSON.parse(item.raw_responses) : item.raw_responses, consensus: item.consensus });
                    setPrompt(item.prompt);
                    setHistoryOpen(false);
                }}>
                    <div className="history-item-date">{new Date(item.timestamp).toLocaleString()}</div>
                    <div className="history-item-prompt">{item.prompt}</div>
                </div>
            ))}
        </div>

        <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
            <ReactFlowProvider>
                <Sidebar />
                <div className="reactflow-wrapper" ref={reactFlowWrapper} style={{ flexGrow: 1 }}>
                    {loading && <div style={{position:'absolute', top:'10px', left:'10px', zIndex: 10, color: 'black', background: '#00ffff', padding: '10px 20px', borderRadius: '4px', fontWeight: 'bold', boxShadow: '0 0 20px #00ffff'}}>INITIALIZING SWARM... PROCESSING</div>}
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={setReactFlowInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        fitView
                    >
                        <Background color='rgba(0,255,255,0.05)' gap={20} size={1} />
                        <Controls style={{background: 'rgba(0,0,0,0.8)', border: '1px solid #00ffff', fill: '#00ffff'}}/>
                    </ReactFlow>
                </div>
            </ReactFlowProvider>
        </div>

        {results && (
            <div id="results-panel" style={{ height: '45vh', display: 'flex', flexDirection: 'column', color: 'white', borderTop: '2px solid #00ffff', background: '#0a0a0c' }}>
                <div style={{padding: '15px 20px', background: 'rgba(0, 255, 255, 0.05)', borderBottom: '1px solid rgba(0, 255, 255, 0.2)', flexShrink: 0}}>
                    <h3 style={{color: '#00ffff', margin: 0, fontSize: '16px', letterSpacing: '2px', fontFamily: 'Orbitron'}}>MASTER SYNTHESIS (CONSENSUS)</h3>
                    <p style={{whiteSpace: 'pre-wrap', fontSize: '14px', marginTop: '10px', maxHeight: '120px', overflowY: 'auto', lineHeight: '1.6'}}>{results.consensus}</p>
                </div>
                
                <div style={{padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: '#111'}}>
                    <h4 style={{margin:0, color: '#88ccff', fontSize: '12px', textTransform: 'uppercase', letterSpacing:'1px'}}>Comparative Internal Vectors</h4>
                </div>

                <div className="results-grid" style={{ padding: '20px', overflowX: 'auto', display: 'flex', gap: '20px', alignItems: 'stretch' }}>
                    {Object.entries(results.rawResponses || {}).map(([model, text]) => (
                        <div key={model} className={`result-card model-${model}`} style={{ flex: '1 1 0', minWidth: '350px', margin: 0, height: '100%', overflowY: 'auto', background: 'rgba(20,20,30,0.8)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
                            <div className="result-card-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '12px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{color: '#fff', fontSize: '15px', fontFamily: 'Orbitron', margin: 0, letterSpacing: '1px'}}>{model.toUpperCase()}</h3>
                                <span className="status-badge" style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '12px', background: 'rgba(0,255,100,0.1)', color: '#00ff66', border: '1px solid rgba(0,255,100,0.3)' }}>SUCCESS</span>
                            </div>
                            <div className="result-card-body" style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '5px' }}>
                                <p style={{whiteSpace: 'pre-wrap', fontSize: '13.5px', color: '#e0e0e0', lineHeight: '1.6', margin: 0}}>{text}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}
    </div>
  );
}

