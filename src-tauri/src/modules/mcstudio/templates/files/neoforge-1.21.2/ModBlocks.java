package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

public final class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks({{main_class}}.MOD_ID);

    // @mcstudio:blocks (Mod Studio adds new blocks above this line)

    private ModBlocks() {}

    /** Since 1.21.2 blocks and their items must know their registry keys before they are built. */
    private static DeferredBlock<Block> registerBlock(String name, BlockBehaviour.Properties properties) {
        DeferredBlock<Block> block = BLOCKS.register(name, id -> new Block(properties.setId(ResourceKey.create(Registries.BLOCK, id))));
        ModItems.ITEMS.register(name, id -> new BlockItem(block.get(),
                new Item.Properties().setId(ResourceKey.create(Registries.ITEM, id)).useBlockDescriptionPrefix()));
        return block;
    }
}
