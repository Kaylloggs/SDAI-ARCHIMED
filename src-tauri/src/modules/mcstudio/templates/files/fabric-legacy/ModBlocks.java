package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraft.util.Identifier;
import net.minecraft.util.registry.Registry;

public final class ModBlocks {
	// @mcstudio:blocks (Mod Studio adds new blocks above this line)

	private ModBlocks() {}

	private static Block register(String name, Block block) {
		Identifier id = {{main_class}}.id(name);
		Registry.register(Registry.ITEM, id, new BlockItem(block, new Item.Settings().group(ItemGroup.BUILDING_BLOCKS)));
		return Registry.register(Registry.BLOCK, id, block);
	}

	/** Loading this class registers every block declared above. */
	public static void init() {
	}
}
