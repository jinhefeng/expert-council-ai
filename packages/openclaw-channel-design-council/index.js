const DesignCouncilAdapter = require("./adapter");

module.exports = {
  id: "design-council",
  name: "Design Council Integration Channel",
  type: "channel",
  
  // Initialize the channel plugin
  init(context) {
    const { config, gateway } = context;
    
    // Check configuration
    if (!config.botToken) {
      console.error("[DesignCouncil-Channel] Error: 'botToken' is required in configurations.");
      return;
    }
    
    const adapter = new DesignCouncilAdapter(config, gateway);
    adapter.start();
    
    // Bind adapter to context so OpenClaw can route replies back
    context.registerAdapter("design-council", adapter);
    console.log("[DesignCouncil-Channel] Channel plugin initialized successfully.");
  }
};
