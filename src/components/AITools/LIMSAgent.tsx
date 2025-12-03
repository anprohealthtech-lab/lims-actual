import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Settings, Save, Loader } from 'lucide-react';

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'bot';
    timestamp: Date;
}

const LIMSAgent: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            text: 'Hello! I am your LIMS Agent. Please configure my endpoint in settings to get started.',
            sender: 'bot',
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    // Settings state
    const [agentEndpoint, setAgentEndpoint] = useState('');
    const [agentToken, setAgentToken] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Load settings from localStorage
        const savedEndpoint = localStorage.getItem('lims_agent_endpoint');
        const savedToken = localStorage.getItem('lims_agent_token');

        if (savedEndpoint) setAgentEndpoint(savedEndpoint);
        if (savedToken) setAgentToken(savedToken);

        if (savedEndpoint) {
            setMessages(prev => [
                ...prev,
                {
                    id: '2',
                    text: 'I am connected and ready to answer your questions about quotations, TAT, prices, and more.',
                    sender: 'bot',
                    timestamp: new Date()
                }
            ]);
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleSaveSettings = (e: React.FormEvent) => {
        e.preventDefault();
        localStorage.setItem('lims_agent_endpoint', agentEndpoint);
        localStorage.setItem('lims_agent_token', agentToken);
        setShowSettings(false);

        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: 'Settings saved! You can now start chatting.',
            sender: 'bot',
            timestamp: new Date()
        }]);
    };

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        if (!agentEndpoint) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: 'Please configure the Agent Endpoint URL in settings first.',
                sender: 'bot',
                timestamp: new Date()
            }]);
            setShowSettings(true);
            return;
        }

        const userMessage: Message = {
            id: Date.now().toString(),
            text: input,
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setLoading(true);

        try {
            const headers: HeadersInit = {
                'Content-Type': 'application/json',
            };

            if (agentToken) {
                headers['Authorization'] = `Bearer ${agentToken}`;
            }

            const response = await fetch(agentEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ query: userMessage.text }),
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.statusText}`);
            }

            const data = await response.json();

            // Handle different response formats (adjust based on actual DigitalOcean Agent response)
            const botResponseText = data.response || data.answer || data.message || JSON.stringify(data);

            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                text: botResponseText,
                sender: 'bot',
                timestamp: new Date()
            }]);

        } catch (error) {
            console.error('Agent Error:', error);
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                text: `Error: ${error instanceof Error ? error.message : 'Failed to connect to agent'}`,
                sender: 'bot',
                timestamp: new Date()
            }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[600px] bg-gray-50 rounded-lg border border-gray-200 overflow-hidden relative">
            {/* Chat Header */}
            <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-100 p-2 rounded-lg">
                        <Bot className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900">LIMS Agent</h3>
                        <p className="text-xs text-gray-500">Connected to your DigitalOcean Agent</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                    title="Agent Settings"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>

            {/* Settings Overlay */}
            {showSettings && (
                <div className="absolute inset-0 bg-white z-10 p-6 flex flex-col animate-in fade-in slide-in-from-top-4 duration-200">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-gray-900">Agent Configuration</h3>
                        <button
                            onClick={() => setShowSettings(false)}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            Close
                        </button>
                    </div>

                    <form onSubmit={handleSaveSettings} className="space-y-4 max-w-md mx-auto w-full">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Agent Endpoint URL *
                            </label>
                            <input
                                type="url"
                                required
                                value={agentEndpoint}
                                onChange={(e) => setAgentEndpoint(e.target.value)}
                                placeholder="https://your-agent-endpoint.com/api/chat"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                The URL where your DigitalOcean Agent is hosted.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Auth Token (Optional)
                            </label>
                            <input
                                type="password"
                                value={agentToken}
                                onChange={(e) => setAgentToken(e.target.value)}
                                placeholder="Bearer token or API key"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="pt-4">
                            <button
                                type="submit"
                                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition-colors"
                            >
                                <Save className="w-4 h-4" />
                                Save Configuration
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[80%] rounded-lg p-3 ${msg.sender === 'user'
                                ? 'bg-indigo-600 text-white rounded-br-none'
                                : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'
                                }`}
                        >
                            <div className="flex items-start gap-2">
                                {msg.sender === 'bot' && <Bot className="w-4 h-4 mt-1 flex-shrink-0 text-indigo-500" />}
                                <div className="whitespace-pre-wrap text-sm">{msg.text}</div>
                                {msg.sender === 'user' && <User className="w-4 h-4 mt-1 flex-shrink-0 text-indigo-200" />}
                            </div>
                            <div
                                className={`text-[10px] mt-1 text-right ${msg.sender === 'user' ? 'text-indigo-200' : 'text-gray-400'
                                    }`}
                            >
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-gray-200 rounded-lg p-3 rounded-bl-none shadow-sm">
                            <Loader className="w-4 h-4 animate-spin text-gray-400" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSend} className="p-4 bg-white border-t border-gray-200">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask your agent..."
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || loading}
                        className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default LIMSAgent;
