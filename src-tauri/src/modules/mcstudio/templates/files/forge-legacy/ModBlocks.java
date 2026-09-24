package {{package}}.registry;

import java.util.function.Supplier;
import {{package}}.{{main_class}};
import net.minecraft.block.Block;
import net.minecraft.block.SoundType;
import net.minecraft.block.material.Material;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraftforge.fml.RegistryObject;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;

public final class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS = new DeferredRegister<>(ForgeRegistries.BLOCKS, {{main_class}}.MOD_ID);

    // @mcstudio:blocks (Mod Studio adds new blocks above this line)

    private ModBlocks() {}

    private static RegistryObject<Block> registerBlock(String name, Supplier<Block> block) {
        RegistryObject<Block> result = BLOCKS.register(name, block);
        ModItems.ITEMS.register(name, () -> new BlockItem(result.get(), new Item.Properties().tab(ItemGroup.TAB_BUILDING_BLOCKS)));
        return result;
    }
}
