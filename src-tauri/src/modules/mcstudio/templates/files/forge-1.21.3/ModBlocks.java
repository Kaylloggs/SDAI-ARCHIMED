package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public final class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS = DeferredRegister.create(ForgeRegistries.BLOCKS, {{main_class}}.MOD_ID);

    // @mcstudio:blocks (Mod Studio adds new blocks above this line)

    private ModBlocks() {}

    /** Since 1.21.2 blocks and their items must know their registry keys before they are built. */
    private static RegistryObject<Block> registerBlock(String name, BlockBehaviour.Properties properties) {
        ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK, ResourceLocation.fromNamespaceAndPath({{main_class}}.MOD_ID, name));
        RegistryObject<Block> result = BLOCKS.register(name, () -> new Block(properties.setId(key)));
        ModItems.ITEMS.register(name, () -> new BlockItem(result.get(), new Item.Properties().setId(ModItems.key(name)).useBlockDescriptionPrefix()));
        return result;
    }
}
