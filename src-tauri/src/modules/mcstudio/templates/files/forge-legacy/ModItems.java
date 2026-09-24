package {{package}}.registry;

import {{package}}.{{main_class}};
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraftforge.fml.RegistryObject;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;

public final class ModItems {
    public static final DeferredRegister<Item> ITEMS = new DeferredRegister<>(ForgeRegistries.ITEMS, {{main_class}}.MOD_ID);

    // @mcstudio:items (Mod Studio adds new items above this line)

    private ModItems() {}
}
