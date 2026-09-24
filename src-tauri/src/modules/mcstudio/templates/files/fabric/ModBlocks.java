package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.sound.BlockSoundGroup;
import net.minecraft.util.Identifier;

public final class ModBlocks {
	// @mcstudio:blocks (Mod Studio adds new blocks above this line)

	private ModBlocks() {}

	private static Block register(String name, Block block) {
		Identifier id = {{main_class}}.id(name);
		Registry.register(Registries.ITEM, id, new BlockItem(block, new Item.Settings()));
		return Registry.register(Registries.BLOCK, id, block);
	}

	/** Loading this class registers every block declared above. */
	public static void init() {
	}
}
