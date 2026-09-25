package {{package}}.registry;

import java.util.function.Function;
import {{package}}.{{main_class}};
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;

public final class ModBlocks {
	// @mcstudio:blocks (Mod Studio adds new blocks above this line)

	private ModBlocks() {}

	/** Blocks and their items must know their registry keys before they are built. */
	private static Block register(String name, Function<BlockBehaviour.Properties, Block> factory, BlockBehaviour.Properties properties) {
		ResourceKey<Block> blockKey = ResourceKey.create(Registries.BLOCK, {{main_class}}.id(name));
		Block block = factory.apply(properties.setId(blockKey));
		ResourceKey<Item> itemKey = ResourceKey.create(Registries.ITEM, {{main_class}}.id(name));
		Registry.register(BuiltInRegistries.ITEM, itemKey,
				new BlockItem(block, new Item.Properties().setId(itemKey).useBlockDescriptionPrefix()));
		return Registry.register(BuiltInRegistries.BLOCK, blockKey, block);
	}

	/** Loading this class registers every block declared above. */
	public static void init() {
	}
}
