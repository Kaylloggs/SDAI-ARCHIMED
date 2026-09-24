package {{package}}.registry;

import java.util.function.Function;
import {{package}}.{{main_class}};
import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.sound.BlockSoundGroup;

public final class ModBlocks {
	// @mcstudio:blocks (Mod Studio adds new blocks above this line)

	private ModBlocks() {}

	/** Since 1.21.2 blocks and their items must know their registry keys before they are built. */
	private static Block register(String name, Function<AbstractBlock.Settings, Block> factory, AbstractBlock.Settings settings) {
		RegistryKey<Block> blockKey = RegistryKey.of(RegistryKeys.BLOCK, {{main_class}}.id(name));
		Block block = factory.apply(settings.registryKey(blockKey));
		RegistryKey<Item> itemKey = RegistryKey.of(RegistryKeys.ITEM, {{main_class}}.id(name));
		Registry.register(Registries.ITEM, itemKey,
				new BlockItem(block, new Item.Settings().registryKey(itemKey).useBlockPrefixedTranslationKey()));
		return Registry.register(Registries.BLOCK, blockKey, block);
	}

	/** Loading this class registers every block declared above. */
	public static void init() {
	}
}
