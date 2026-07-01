using Godot;

// Minimal C# node for the cross-version fixture. Carries the three attributes
// smoke §25 (and the toolkit's C# tools) key off:
//   [GlobalClass] — appears in classdb_search after build+reload
//   [Export]      — property surface for node.get_property / node.set_property
//   [Signal]      — enumerated by signal.list
// Compiled editor-free by the dotnet-build floor; loaded by the mono editor in
// the behavioral §25 tier.
[GlobalClass]
public partial class McpValCsNode : Node
{
	[Signal]
	public delegate void PokedEventHandler(int amount);

	[Export]
	public int Speed { get; set; } = 200;

	[Export]
	public string PlayerName { get; set; } = "Val";

	public override void _Ready()
	{
		GD.Print($"McpValCsNode ready: {PlayerName} @ {Speed}");
	}
}
