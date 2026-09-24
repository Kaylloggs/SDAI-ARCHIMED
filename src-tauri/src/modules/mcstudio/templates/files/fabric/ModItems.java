package {{package}}.registry;

import {{package}}.{{main_class}};
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroups;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;

public final class ModItems {
	// @mcstudio:items (Mod Studio adds new items above this line)

	private ModItems() {}

	private static Item register(String name, Item item) {
		return Registry.register(Registries.ITEM, {{main_class}}.id(name), item);
	}

	public static void init() {
		ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS).register(entries -> {
			// @mcstudio:creative-tab
		});
	}
}
