package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraft.util.registry.Registry;

public final class ModItems {
	// @mcstudio:items (Mod Studio adds new items above this line)

	private ModItems() {}

	private static Item register(String name, Item item) {
		return Registry.register(Registry.ITEM, {{main_class}}.id(name), item);
	}

	/** Loading this class registers every item declared above. */
	public static void init() {
	}
}
