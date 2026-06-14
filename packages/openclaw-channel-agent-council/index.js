const AgentCouncilAdapter = require("./adapter");

module.exports = {
  id: "agent-council",
  name: "Agent Council Integration Channel",
  type: "channel",
  
  // Initialize the channel plugin
  init(context) {
    const { config, gateway } = context;
    
    // Check configuration
    if (!config.botToken) {
      console.error("[AgentCouncil-Channel] Error: 'botToken' is required in configurations.");
      return;
    }
    
    const adapter = new AgentCouncilAdapter(config, gateway);
    adapter.start();
    
    // Bind adapter to context so OpenClaw can route replies back
    context.registerAdapter("agent-council", adapter);
    console.log("[AgentCouncil-Channel] Channel plugin initialized successfully.");
  }
};
